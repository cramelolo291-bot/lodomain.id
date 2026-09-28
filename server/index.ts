// The server.
//
//   node/tsx server/index.ts      → API on :8787, frontend from dist/
//   bun run dev:full              → this plus `vite` on :5173, proxied
//
// Boot order matters: verify the database is current, repair orphaned pool
// state, then start listening. Failing at boot is better than serving 500s.

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { env, isProd } from "./env";
import { assertCurrent, migrate } from "./db/migrate";
import { close, ping, pool } from "./db/client";
import { pruneSessions } from "./auth/session";
import { pruneMagicLinks } from "./auth/magic-link";
import { clearExpiredCooldowns, resetOrphans } from "./ollama/pool";
import { isUp } from "./ollama/client";
import { bodyLimit, rateLimit } from "./http/rate-limit";
import { auth } from "./routes/auth";
import { routes } from "./routes/conversations";
import { dataSpace } from "./routes/data-space";
import { panel } from "./routes/panel";
import { openai } from "./routes/openai-compat";

const app = new Hono();

app.use("*", logger());
app.use("*", secureHeaders());
app.use("/api/auth/magic-link", rateLimit({ limit: 5, windowMs: 60_000, scope: "magic" }));
app.use("/api/auth/verify", rateLimit({ limit: 20, windowMs: 60_000, scope: "verify" }));
app.use("/api/keys", rateLimit({ limit: 20, windowMs: 60_000, scope: "keys" }));
app.use("/api/turn", rateLimit({ limit: 60, windowMs: 60_000, scope: "turn" }));
app.use("/v1/*", rateLimit({ limit: env.API_RATE_LIMIT, windowMs: env.API_RATE_WINDOW_MS, scope: "v1" }));
app.use("/api/*", bodyLimit(2_000_000));

// The frontend is served from the same origin in production, so CORS is only
// needed for the Vite dev server proxying /api and /v1.
app.use(
  "/api/*",
  cors({
    origin: isProd ? [] : ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true,
  }),
);
app.use("/v1/*", cors({ origin: "*" }));

app.route("/api", auth);
app.route("/api", routes);
app.route("/api", dataSpace);
app.route("/api", panel);
app.route("/", openai);

app.get("/api/health", async (c) => {
  const [dbUp, ollamaUp] = await Promise.all([ping(), isUp()]);
  return c.json({ ok: dbUp, database: dbUp, ollama: ollamaUp, version: 1 }, dbUp ? 200 : 503);
});

app.onError((err, c) => {
  console.error("[error]", err);
  const status = "status" in err && typeof err.status === "number" ? err.status : 500;
  return c.json({ error: { message: err.message } }, status as 400);
});

app.notFound((c) => c.json({ error: { message: "Not found" } }, 404));

// ── Static frontend ────────────────────────────────────────────────────────

if (isProd) {
  const dir = join(process.cwd(), env.STATIC_DIR);

  // Hash-named assets are immutable, so they can be cached hard. index.html
  // must not be, or a deploy never reaches the browser.
  app.use("/assets/*", async (c, next) => {
    const path = c.req.path.replace(/^\/+/, "");
    try {
      const body = await readFile(join(dir, path));
      c.header("cache-control", "public, max-age=31536000, immutable");
      c.header("content-type", contentType(path));
      return c.body(body as unknown as ArrayBuffer);
    } catch {
      return next();
    }
  });

  // History fallback: any non-API path returns index.html so client-side routes
  // like /chat and /server survive a hard refresh.
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api") || c.req.path.startsWith("/v1")) {
      return c.json({ error: { message: "Not found" } }, 404);
    }
    try {
      const html = await readFile(join(dir, "index.html"), "utf8");
      c.header("cache-control", "no-cache");
      return c.html(html);
    } catch {
      return c.text(
        "Frontend not built. Run `bun run build` first, or use `bun run dev:full`.",
        500,
      );
    }
  });
}

function contentType(path: string): string {
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

// ── Boot ───────────────────────────────────────────────────────────────────

async function boot() {
  console.log("→ checking database");
  if (!(await ping())) {
    console.error(
      `\n  Cannot reach PostgreSQL at ${env.DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}\n` +
        "  Start it with `docker compose up -d db`, then run `bun run db:migrate`.\n",
    );
    process.exit(1);
  }

  if (process.env.AUTO_MIGRATE === "true") {
    const n = await migrate();
    if (n) console.log(`→ applied ${n} migration(s)`);
  } else {
    await assertCurrent();
  }

  console.log("→ repairing state");
  const orphans = await resetOrphans();
  const cooldowns = await clearExpiredCooldowns();
  const sessions = await pruneSessions();
  const links = await pruneMagicLinks();
  console.log(
    `  ${orphans} orphaned slots · ${cooldowns} cooldowns · ${sessions} sessions · ${links} links`,
  );

  const ollamaUp = await isUp();
  if (!ollamaUp) {
    console.warn(
      `\n  Ollama is not answering at ${env.OLLAMA_URL}.\n` +
        "  Turns will fail until it is up. Start it with `ollama serve`.\n",
    );
  }

  serve({ fetch: app.fetch, port: env.PORT }, (info: { port: number }) => {
    console.log(`\n  Lolo AI server → http://localhost:${info.port}`);
    console.log(`  database        ${env.DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`);
    console.log(`  ollama          ${env.OLLAMA_URL} ${ollamaUp ? "✓" : "✗"}`);
    console.log(`  openai base     ${env.APP_URL}/v1\n`);
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n${signal} — closing.`);
    void close().finally(() => process.exit(0));
  });
}

process.on("unhandledRejection", (reason) => {
  console.error("[unhandled]", reason);
});

void boot();

export { app, pool };
