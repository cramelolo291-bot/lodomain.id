# Environment

Everything the server reads. Copy the block below into a file named `.env` in
the project root. **Never commit it.**

```bash
cp .env.example .env
```

Or just create `.env` by hand and paste the contents of the code block in
[Variables](#variables).

## Variables

```ini
# ── Server ──────────────────────────────────────────────────────────────
NODE_ENV=development
PORT=8787
# Public origin. Magic links are built from this, so in production it must be
# the address your friends actually reach, not localhost.
APP_URL=http://localhost:5173
STATIC_DIR=dist

# ── Database ────────────────────────────────────────────────────────────
# Matches the credentials in docker-compose.yml. Loopback only.
DATABASE_URL=postgres://lolo:lolo@127.0.0.1:5432/lolo
# Applies pending migrations on boot. Convenient for one box; leave it false in
# production and run migrations as their own deploy step.
AUTO_MIGRATE=true

# ── Auth ─────────────────────────────────────────────────────────────────
SESSION_COOKIE=lolo_session
SESSION_TTL_HOURS=720
MAGIC_LINK_TTL_MINUTES=15
# Exact comma-separated production sign-in allowlist; unlisted emails receive no login link.
ALLOWED_EMAILS=owner@example.com,member@example.com
# Comma-separated emails allowed to administer a production deployment.
# Required for production admin access; never rely on first-signup bootstrap.
ADMIN_EMAILS=owner@example.com

# Without a key, magic links are printed to the server log instead of sent.
# Enough to develop against; set it to send real mail.
# RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
# MAIL_FROM=Lolo <lolo@yourdomain.com>

# ── Ollama ───────────────────────────────────────────────────────────────
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_TIMEOUT_MS=120000
OLLAMA_KEEPALIVE_MS=45000

# ── Scheduler ────────────────────────────────────────────────────────────
# Base cooldown for a failing upstream. 401 gets 6x, 429 gets 2x.
COOLDOWN_MS=30000
# How many pool accounts one request may try before giving up.
MAX_ATTEMPTS=3

# ── OpenAI-compatible API ────────────────────────────────────────────────
API_RATE_LIMIT=600
API_RATE_WINDOW_MS=60000

# ── Edge and logs ────────────────────────────────────────────────────────
# Leave empty unless a reverse proxy (Caddy, nginx, Cloudflare, a tunnel) sits
# in front. `x-forwarded-for` is set by the client, so believing it without a
# trusted hop in front hands every rate limiter a spoofable identity — anyone
# could rotate the header and walk past the limits. Set to `*` to trust any
# peer, or to a comma-separated list of proxy IPs to trust only those.
# TRUST_PROXY=10.0.0.1
# Hard cap on tracked rate-limit buckets, so the map cannot grow on a
# long-lived process under a flood of unique addresses.
RATE_LIMIT_MAX_KEYS=20000
# debug | info | warn | error. In production logs are JSON, one object per line.
# Anything below info hides the per-request lines.
LOG_LEVEL=info

# ── Frontend (Vite) ──────────────────────────────────────────────────────
# This is the line that connects the workspace UI to the real database.
# http makes the built frontend talk to the Hono server instead of the
# in-browser mock.
VITE_API_MODE=http
VITE_API_URL=http://localhost:8787
```

The checked-in `.env.example` supplies a loopback-only development database URL,
but the server itself now requires `DATABASE_URL` to be explicitly present; it
never silently falls back to a predictable credential. In production, set a
strong unique database password, the real `APP_URL`, `ALLOWED_EMAILS`,
`ADMIN_EMAILS`, and `RESEND_API_KEY`.
Without `RESEND_API_KEY`, login links are written to server logs, so do not use
that fallback on a public production deployment.

## First run

```bash
# 1. Postgres
docker compose up -d db

# 2. Ollama — use the compose service, or an existing host install
docker compose up -d ollama
# …or, if Ollama already runs on the host, delete the ollama service and set
# OLLAMA_URL=http://host.docker.internal:11434

# 3. Pull a model. Start small; 8B is the floor for usable tool-calling.
ollama pull qwen3:8b

# 4. Schema
bun run db:migrate

# 5. Both halves
bun run dev:full
```

Then open <http://localhost:5173>.

In development and tests, the first account can bootstrap the **admin**. In
production, sign-in is closed by default. Set `ALLOWED_EMAILS` to a comma-separated
allowlist of exact addresses that may sign in, and set `ADMIN_EMAILS` to the
subset allowed to administer the deployment. Admin addresses are allowed to sign
in even if omitted from `ALLOWED_EMAILS`. Allowlist changes are enforced on sign-in
and session checks; removing an address from `ADMIN_EMAILS` demotes its admin role.
Without either allowlist, no production account can sign in or become admin.

## Ollama sizing

Pick by what the machine actually has. Getting this wrong means the server
swaps models and a turn takes 30 seconds.

| Available VRAM / RAM | Model | Notes |
|---|---|---|
| 8 GB | `qwen3:8b` (q4) | The floor. One user at a time. |
| 16 GB | `qwen3:14b` or `qwen3:30b-a3b` | MoE, so it stays responsive. |
| 24 GB+ | `qwen2.5-coder:32b` | Best code quality. |
| No GPU, 32 GB RAM | `llama3.1:8b` | CPU-only; expect ~10 tok/s. |

`OLLAMA_NUM_PARALLEL=2` in docker-compose assumes two concurrent turns. Raise
it if the model fits with room to spare; lower it to 1 if turns are swapping.

## Email

Without `RESEND_API_KEY`, the server prints the magic link to stdout. That is
enough to develop against, and it is a deliberate fallback rather than a silent
failure.

To send real mail:

1. Verify your own domain in Resend (add the DKIM and MX records it shows).
2. Set `RESEND_API_KEY` and `MAIL_FROM` to an address on that domain.

While sending from a `@resend.app` address, Resend only delivers to addresses
registered on the account — so links reach you but not your friends. Verifying
your own domain is the fix, and it is free.

## Secrets

Nothing sensitive is ever stored in the database in plain form:

| Credential | Stored as | Recoverable? |
|---|---|---|
| Session token | SHA-256 | No |
| Magic link token | SHA-256 | No |
| API key | SHA-256 | Shown once at creation, then no |

`api_keys.prefix` holds the first 12 characters so a key is recognisable in a
list. That prefix is not enough to use the key.

A database dump contains no usable credential. Rotate anything that leaks.

Never commit `.env`, `.env.keys`, or encrypted environment files. If a dotenv private key was committed in an earlier revision, deleting the file in a new commit is not enough: rotate the key and purge the leaked value from repository history before treating it as resolved.

## Switching the UI to the real backend

The frontend runs against an in-browser mock by default so it is explorable
with no server attached. Two lines in `.env` connect it to Postgres:

```
VITE_API_MODE=http
VITE_API_URL=http://localhost:8787
```

Then restart Vite. The frontend already speaks the server's exact response
shapes, so nothing above the transport layer changes. To go back to the mock,
set `VITE_API_MODE=mock` or remove the line.

## Troubleshooting

**`Cannot reach PostgreSQL`** — `docker compose ps`. If the container is
unhealthy, `docker compose logs db`; usually a port already bound on 5432.

**`Database is behind: 2/3 migrations applied`** — `bun run db:migrate`, or set
`AUTO_MIGRATE=true`.

**Turns fail with a connection error** — check `ollama list`. If Ollama is not
running the server still boots and says so, rather than failing to start.

**`no such table`** — the migration ran against a different database than the
server reads. Compare `DATABASE_URL` in both.

**Every turn returns 401** — the magic link was opened twice. They are
single-use by design; request a new one.

**Magic link never arrives** — check the server log first. If the link was
printed, mail is not configured. If it was sent, confirm the recipient is
allowed to receive from your sending domain.

## Backup and restore

The database is the product. Three commands, all reading the same connection
the server uses — no `pg_dump` required.

```
bun run db:backup                # → backups/lolo-<timestamp>.json
bun run db:list-backups
bun run db:verify                # exits 1 and lists problems if the schema drifted
bun run db:restore backups/lolo-2026-09-28-07-00-00.json
```

`db:verify` is the one to run in CI or after a deploy: it compares the applied
migrations against the files this build ships and reports any missing table.

`db:restore` replaces what is there. Foreign keys are suspended for the load and
re-enabled before the connection returns to the pool, and the whole insert runs
in one transaction, so a failure mid-way rolls back instead of leaving half the
tables truncated. Restore a dump taken from a *different* schema version and it
will fail on the missing columns — restore migrations first, then data.

A nightly `bun run db:backup` on the server box, plus a real `pg_dump` if you
want indexes and constraints preserved, is enough to lose nothing.

## Reading the logs

Every response carries an `x-request-id`. Production logs are one JSON object
per line, and that id is on every one of them, so a slow or failed request can
be pulled out of a log file by grep:

```
grep '"requestId":"<id>"' server.log
```

A client that already sends `x-request-id` keeps its value, so the id spans the
browser, the proxy and the server. Anything that looks like a log injection —
a newline in the header, a control character — is discarded and replaced with a
fresh id rather than reflected.

Fields named `authorization`, `cookie`, `password`, `token`, `secret` or
`api_key` are replaced with `[redacted]` before a line is written, at any
depth. A 5xx logs the full stack server-side and answers the client a bare
`Internal server error`.

## Production execution safety

The current build and dev-server runner executes package lifecycle scripts as the server OS user; it is not a container sandbox. For that reason, production build and live dev-server endpoints fail closed until an isolated worker is configured. Do not remove this guard to make previews work. Configure a dedicated sandboxed worker first, then route build and preview jobs to that worker.
