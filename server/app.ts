// The Hono app, with no side effects.
//
// Kept separate from `index.ts` so tests can import the app and drive it
// without binding a port or running the boot sequence. Importing this module
// must never start a listener.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { env, isProd } from "./env";
import { ping } from "./db/client";
import { isUp } from "./ollama/client";
import { bodyLimit, rateLimit } from "./http/rate-limit";
import { auth } from "./routes/auth";
import { routes } from "./routes/conversations";
import { dataSpace } from "./routes/data-space";
import { panel } from "./routes/panel";
import { turnStream } from "./routes/turn-stream";
import { openai } from "./routes/openai-compat";

export function createApp() {
  const app = new Hono();

  // Silent in tests; Hono's logger writes to stdout on every request.
  if (env.NODE_ENV !== "test") app.use("*", logger());
  app.use("*", secureHeaders());

  // Tighter limits on the endpoints that cost money or send mail.
  app.use("/api/auth/magic-link", rateLimit({ limit: 5, windowMs: 60_000, scope: "magic" }));
  app.use("/api/auth/verify", rateLimit({ limit: 20, windowMs: 60_000, scope: "verify" }));
  app.use("/api/keys", rateLimit({ limit: 20, windowMs: 60_000, scope: "keys" }));
  app.use("/api/turn", rateLimit({ limit: 60, windowMs: 60_000, scope: "turn" }));
  app.use("/api/turn/stream", rateLimit({ limit: 60, windowMs: 60_000, scope: "turn" }));
  app.use("/v1/*", rateLimit({ limit: env.API_RATE_LIMIT, windowMs: env.API_RATE_WINDOW_MS, scope: "v1" }));
  app.use("/api/*", bodyLimit(2_000_000));

  // Same-origin in production, so CORS is only for the Vite dev server.
  app.use(
    "/api/*",
    cors({
      origin: isProd ? [] : ["http://localhost:5173", "http://127.0.0.1:5173"],
      credentials: true,
    }),
  );
  app.use("/v1/*", cors({ origin: "*" }));

  // Registered before the routers on purpose. `routes` mounts a
  // `use("*", requireAuth)`, and Hono applies that to every /api path mounted
  // after it — which would put the health check behind a session cookie and
  // make it useless for a load balancer or `docker healthcheck`.
  app.get("/api/health", async (c) => {
    const [dbUp, ollamaUp] = await Promise.all([ping(), isUp()]);
    return c.json({ ok: dbUp, database: dbUp, ollama: ollamaUp, version: 1 }, dbUp ? 200 : 503);
  });

  app.route("/api", auth);
  app.route("/api", routes);
  app.route("/api", dataSpace);
  app.route("/api", panel);
  // Mounted after `routes` so the shared body limit applies, and before the
  // OpenAI router whose prefix is `/`.
  app.route("/api", turnStream);
  app.route("/", openai);

  app.onError((err, c) => {
    console.error("[error]", err);
    const status = "status" in err && typeof err.status === "number" ? err.status : 500;
    return c.json({ error: { message: err.message } }, status as 400);
  });

  app.notFound((c) => c.json({ error: { message: "Not found" } }, 404));

  if (isProd) mountStatic(app);

  return app;
}

function contentType(path: string): string {
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function mountStatic(app: Hono) {
  const dir = join(process.cwd(), env.STATIC_DIR);

  // Hash-named assets are immutable and can be cached hard. index.html must
  // not be, or a deploy never reaches the browser.
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

export const app = createApp();
