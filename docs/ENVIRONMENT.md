# Environment

Everything the server reads. Copy the block below into a file named `.env` in
the project root. **Never commit it.**

```bash
cp docs/ENVIRONMENT.md .env   # then delete everything above this line
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

# ── Frontend (Vite) ──────────────────────────────────────────────────────
# This is the line that connects the workspace UI to the real database.
# http makes the built frontend talk to the Hono server instead of the
# in-browser mock.
VITE_API_MODE=http
VITE_API_URL=http://localhost:8787
```

Only `DATABASE_URL` has a usable default. Everything else falls back to a
sane value so a fresh checkout starts, but `APP_URL` and `RESEND_API_KEY` are
the two you will actually have to set.

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

The first account to complete a magic link becomes the **admin** and is the only
one who can see the pool, traces of other users, and the guardrail log. Every
account after is a regular user.

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
