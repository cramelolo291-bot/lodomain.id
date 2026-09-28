# syntax=docker/dockerfile:1.7

# ── Build ────────────────────────────────────────────────────────────────
# The frontend is built here and nowhere else, so the runtime image never
# carries a bundler, a TypeScript compiler, or the dev dependency tree for the
# UI.
FROM oven/bun:1-alpine AS build

WORKDIR /app

# Copied on their own so a source-only change does not re-resolve the whole
# dependency tree on every build.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# `tsc -b` then `vite build`. The build failing is the point of this stage.
RUN bun run build


# ── Runtime ──────────────────────────────────────────────────────────────
# The server is run with tsx, exactly like `bun run server`, because
# tsconfig.server.json is noEmit with extensionless imports — compiling it to
# plain ESM would mean rewriting every import in server/. The cost is the dev
# dependency tree, which is a fair trade for the app booting from the same
# command on a laptop and in a container.
FROM oven/bun:1-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    STATIC_DIR=dist

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# The server and the two files it shares with the frontend. Nothing else: no
# tests, no scripts, no frontend source.
COPY server ./server
COPY src/lib ./src/lib

# Where db:backup writes. Mounted as a volume in compose so dumps survive a
# rebuild.
RUN mkdir -p /app/backups && chown -R bun:bun /app

USER bun

EXPOSE 8787

# /api/health returns 503 when Postgres is unreachable, so this fails the
# container rather than reporting a healthy server that cannot serve.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/api/health >/dev/null 2>&1 || exit 1

CMD ["bun", "run", "server"]
