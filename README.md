# Lolo AI

A self-hosted agent studio. One server, one Postgres, one pool of local models —
no hosted backend, no API key for inference, and nothing leaves the machine
unless you put a key in a slot and say so.

It ships two ways to talk to it:

- **The web app** — a workspace where you describe something and get a working
  app on its own URL, plus a chat surface and a server console.
- **An OpenAI-compatible API** — point any editor that speaks
  `/v1/chat/completions` at it, including streaming.

---

## What's in the box

| Piece | Choice | Why |
| --- | --- | --- |
| Frontend | Vite + React 19 + Tailwind v4 + shadcn/ui | — |
| API | Hono on `@hono/node-server` | one file to read, no framework tax |
| Database | PostgreSQL + Drizzle ORM | the product *is* the data |
| Inference | Ollama, local | nothing leaves the box |
| Auth | Resend magic link | no password to leak, no password to reset |
| Mail | Resend, optional | without a key, magic links print to the log |

There is no Convex here. The database is PostgreSQL. Outbound calls can go to
Ollama, to OpenRouter when an API key is configured, and to Resend when email
delivery is configured. Do not assume requests stay on-device when a remote
provider key is enabled.

## Layout

```
src/                 frontend — Vite, React, Tailwind
  pages/             Landing, Auth, Web, Chat, Server, NotFound
  components/        AppShell, DataPanel, Graphics, Intro, ui/ (shadcn)
  lib/               api.ts (dual-mode client), catalog, guardrails, data
server/              the API — Hono
  app.ts             createApp(); no side effects, importable by tests
  index.ts           boot + graceful shutdown
  db/                schema, migrations (plain SQL), backup/restore/verify
  auth/              tokens, sessions, magic links
  ollama/            client, model pool, catalog
  pipeline/          run-turn, prompts, guardrails, data space
  routes/            auth, conversations, data-space, panel, turn-stream, openai-compat, modules, infrastructure
  http/              rate limiting, validation, observability
scripts/             the test suites
docs/ENVIRONMENT.md  every variable, and what breaks when it is wrong
```

`src/lib/{catalog,guardrails,data}.ts` are imported by **both** sides. The
browser and the server agree on what a subagent is and what a prompt injection
looks like because they are literally the same file.

## Quick start

You need Node 20+ or Bun, Docker, and Ollama.

```bash
bun install
cp .env.example .env          # then fill in APP_URL and RESEND_API_KEY
docker compose up -d db       # or your own Postgres
docker compose up -d ollama   # or a host install; set OLLAMA_URL instead
ollama pull qwen3:8b
bun run db:migrate
bun run server                # API on :8787
bun run dev                   # frontend on :5173
```

Without a `RESEND_API_KEY` the magic link is printed to the server log instead
of mailed, so you can sign in end to end before touching any third party.

Full variable reference, Ollama sizing by RAM, and troubleshooting:
**[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)**.

### Real backend by default; mock mode is explicitly opt-in

The frontend uses the real HTTP backend by default. It does not silently fall
back to generated replies when the API is unavailable: requests should fail
visibly rather than inventing a successful response.

For local UI-only exploration, you can explicitly opt into the in-browser mock
in development by setting `VITE_API_MODE=mock`. Mock mode uses seeded browser
state and fixed templates; **it does not call a model, write to PostgreSQL, or
run the real build toolchain**. Production builds ignore this mock opt-in.

For real agent behavior, configure the backend and set these variables in the
Vite environment:

```
VITE_API_MODE=http
VITE_API_URL=http://localhost:8787
```

Then restart Vite. HTTP mode is the default — these settings are only needed
when overriding that default or changing the API host.

What changes when you flip it:

| | mock | http |
|---|---|---|
| The answer | a template | the model in Ollama |
| Files | in `localStorage` | rows in `project_files` |
| Build | not executed | real toolchain in development/tests; production is blocked until an isolated worker exists |
| Preview | local-only generated HTML | built output or live dev server in development; production project previews are blocked until isolated execution exists |
| Data space | in memory | real tables you can edit in the panel |

Mock mode displays a persistent amber **MOCK MODE** banner in the app shell. If that banner is absent, the UI is using the real HTTP backend; an API failure is shown as an error rather than replaced with a canned answer.

## Production

```bash
bun run build                 # emits dist/
NODE_ENV=production bun run server
```

In production the Hono server also serves `dist/`, including the history
fallback so a hard refresh on `/chat` or `/server` works. It expects a reverse
proxy in front of it for TLS — and if you put one there, set `TRUST_PROXY` to
its address so rate limiting sees real clients instead of your proxy's.

Before exposing it, configure `ALLOWED_EMAILS` and `ADMIN_EMAILS`. Production sign-in is denied by default for unlisted addresses, and admin rights never go to the first public signup.

Container build:

```bash
docker compose up -d --build  # db + ollama + app
```

The app container is the whole product: static frontend, API, and migrations.
It waits for Postgres to be healthy, runs `db:migrate` on boot, and reports
liveness on `/api/health`.

Production user-project builds and live dev servers are intentionally disabled until a separate isolated worker is configured. The current runner is not a security sandbox and must not execute project-controlled lifecycle scripts as the production server user.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Vite dev server using the real HTTP API by default; mock only with explicit development opt-in |
| `bun run server` | the Hono server |
| `bun run build` | typecheck + build `dist/` |
| `bun run db:migrate` | apply pending SQL migrations |
| `bun run db:verify` | check the schema matches this build; exits 1 if not |
| `bun run db:backup` | dump to `backups/lolo-<timestamp>.json` |
| `bun run db:restore <file>` | restore, in one transaction |
| `bun run db:list-backups` | list what you have |
| `bun run typecheck` | `tsc -b --noEmit` |
| `bun test` | all ten suites, no framework |

`bun run test` is a set of sequential scripts rather than a test runner, so a
failure names the exact step. `test:api` and `test:harden` stand up PGlite over
a real TCP socket, so the actual pool, the actual Drizzle queries and the actual
Hono routes are exercised — not stubs of them.

## How a turn works

`POST /api/turn/stream` (or `/v1/chat/completions` for the OpenAI shape). One
implementation, `streamTurn`, serves both:

1. Input guardrail — an obvious prompt injection is refused before it reaches a
   model, and the refusal is recorded as a trace.
2. Data space — the project's tables are provisioned if they don't exist yet.
3. Context and compaction — old turns are summarised so the window survives.
4. Pool claim — a model slot is claimed, with a retry across accounts and a
   cooldown when one is unhealthy.
5. Generate — tokens stream out as they arrive.
6. Output guardrail — a connection string, a JWT or a leaked system prompt in
   the response is caught before it reaches the user.
7. Writes, persistence, trace, usage.

Everything in step 1–7 is written to the database, which is what the Server
console renders: pool health, per-turn traces, token usage, and every guardrail
hit with the reason.

## The agent can build what it writes

A model cannot reliably call tools at this size, so the protocol is fenced
blocks — a 7B model produces them, and parsing them is trivial:

````
```lolo:write package.json
{ "name": "app", "scripts": { "build": "vite build" } }
```

```lolo:build
```
````

The write blocks land in the project. The `lolo:build` block makes the server
materialise the whole project into a temporary workspace and run the real
toolchain over it — `npm`/`bun install`, then `npm run build`. Output streams
into the workspace terminal line by line, and a successful build switches the
preview from the string-concatenated fallback to the real `dist/` directory.

You can also build by hand: the **Build** button, or
`POST /api/projects/:project/build` with `{"target":"install|build|typecheck|test"}`.

At most one build runs per turn, and one at a time server-wide. Builds are rate
limited to 6 a minute, because each one installs dependencies.

### It fixes its own mistakes

A failed build is not the end of the turn. The build output goes back to the
model as a follow-up message, and it gets up to two more attempts to fix it —
lower temperature, only the files that need changing, and the same output
guardrail applied to the repair text as to any other model output.

The cap is two on purpose. Each cycle is a model call plus an install plus a
build, so an uncapped loop would turn a two-second turn into a five-minute one,
and a model that cannot fix something in two goes is not going to fix it in
twenty. If it declines to change anything, that is accepted as the answer.

### Live preview

**Start live** runs the project's `dev` script as a long-lived process and
proxies to it, so the preview updates as the agent edits — no rebuild. Every
write the agent makes is pushed into the running workspace, which is what makes
the file watcher fire; a file the agent deleted is removed there too, or the
error never goes away.

The dev server is bound to loopback, `HOST=127.0.0.1` is forced, and it is
stopped on restart and on server shutdown so it cannot outlive the process that
started it.

HMR travels over a WebSocket, and a WebSocket is not an HTTP request — after the
handshake it is two raw sockets speaking a framing protocol that neither side
should be parsing again. Re-encoding it as a `fetch` would mean reimplementing
that protocol, and getting it wrong fails in a way that looks like a bundler
bug. So `server/build/tunnel.ts` does not proxy it. It copies bytes: the
request line and `Host` are rewritten to the dev server's port, the two sockets
are piped into each other, and nothing is interpreted again.

`server/index.ts` hands `upgrade` events to `handleLiveUpgrade`, which redoes
the session check and the project-ownership check that the normal routes
already do — the upgrade path is not a way around them. A dev server that is
not running gets a `502` written back down the same connection, in band, so the
client sees a reason rather than a socket that closed for no visible cause.

The port is never taken from the request. It comes from the process this server
started, and the only thing a client controls is the path.

### Files it can hand back

The agent can write any text file, not just an app. `project_files.content` is
a text column, so a PDF — which is bytes — is never stored. It is rendered on
request:

```
GET /api/projects/:project/file/docs/laporan.md     → the markdown
GET /api/projects/:project/file/docs/laporan.pdf    → a real PDF, rendered now
GET /api/projects/:project/files                    → every file, with both links
```

The `.pdf` path is a rendering request, not a lookup: the server reads the
markdown and lays it out as you download. So editing the markdown changes the
PDF, and the document can never go stale. There is no stored copy to fall out
of sync.

`server/build/pdf.ts` writes the file by hand — object table, cross-reference
table, content stream — rather than pulling in a PDF library. It lays out
headings, paragraphs, bullets, code blocks and rules in Helvetica, paginates,
and numbers the pages. It cannot embed images or use an embedded font: a
base-14 font is one every reader already has, which is what makes a
dependency-free PDF possible at all.

Two things worth knowing about it. Non-Latin characters become `?`, because
Helvetica's WinAnsi encoding has no glyph for them — an Indonesian or Japanese
document needs an embedded font and a real library. And the download filename
is reduced to something inert, so a title cannot inject a header or become a
path.

Anything the agent writes as markdown is therefore printable, without it
having to know PDFs exist.

### What this is not

**The build runner is not a security boundary.** It runs as the server's user,
on the server's machine, and `npm install` executes whatever lifecycle scripts
the generated `package.json` declares. What it does guarantee:

- the command comes from a fixed table, never from the request
- `shell: false`, so nothing is interpolated into a shell
- the child environment is rebuilt from an allowlist — `DATABASE_URL`,
  `RESEND_API_KEY` and session material are not inherited
- `HOME` points at the workspace, not the operator's home
- the process group is killed on timeout, output is capped, and the workspace
  is removed unless a build actually produced output

For code you do not control at all, run the workspace inside a container —
[llm-sandbox](https://github.com/vndee/llm-sandbox) over gVisor/Kata/Firecracker
does this, and [sandboxd](https://github.com/inclusionAI/sandboxd) is the
low-level daemon. That is a deployment decision, and the runner is written so
swapping it does not change the pipeline.

## Security notes

- Session, magic-link and API-key tokens are stored as SHA-256 hashes. The
  plaintext exists once, in the email.
- A magic link is single-use and expires. Sessions are pruned at boot.
- `x-forwarded-for` is ignored unless `TRUST_PROXY` names the proxy in front of
  the server — otherwise anyone can rotate the header and walk past every limit.
- Request bodies are capped by counting real bytes as they are read, not by
  trusting `content-length`.
- Logs redact `authorization`, `cookie`, `password`, `token`, `secret` and
  `api_key` at any depth. A 5xx keeps the stack server-side and returns a bare
  `Internal server error`.
- The OpenAI-compatible surface is scoped to keys you mint in the Server
  console, and each key belongs to the account that minted it.

## Conventions

- Bun for installs and scripts. `npm run` works too.
- Imports use `react-router`, not `react-router-dom`.
- shadcn/ui components live in `src/components/ui` and are used as-is.
- `src/lib` is shared; `server/lib` is server-only.
- Server modules must stay import-safe: importing `server/app.ts` must never
  bind a port. `server/index.ts` is the only file that boots.
- Secrets come from the environment at boot and are never written to disk by the
  app. `.env*` is gitignored; only `.env.example` is tracked.
