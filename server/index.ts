// Process entrypoint. Boots the server; the app itself lives in `app.ts`.
//
//   bun run server        → API on :8787, frontend from dist/
//
// Boot order matters: verify the database is current, repair orphaned pool
// state, then start listening. Failing at boot is better than serving 500s.

import { serve } from "@hono/node-server";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { app } from "./app";
import { env } from "./env";
import { assertCurrent, migrate } from "./db/migrate";
import { close, ping } from "./db/client";
import { pruneSessions } from "./auth/session";
import { pruneMagicLinks } from "./auth/magic-link";
import { clearExpiredCooldowns, resetOrphans } from "./ollama/pool";
import { isUp } from "./ollama/client";
import { stopAllDev } from "./build/dev";
import { handleLiveUpgrade } from "./routes/build";
import { log } from "./http/observability";

/** How long a draining request gets before the process exits anyway. */
const DRAIN_TIMEOUT_MS = 30_000;
const DRAIN_TICK_MS = 100;

/**
 * What shutdown and the upgrade handler need from the listener.
 * @hono/node-server returns a union of an HTTP/1 and an HTTP/2 server, so the
 * surface is narrowed to exactly what is used rather than importing both.
 */
type Closeable = {
  close: (cb: () => void) => unknown;
  closeAllConnections?: () => void;
  on: (event: "upgrade", handler: (req: IncomingMessage, socket: Socket, head: Buffer) => void) => unknown;
};

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

  server = serve({ fetch: counted, port: env.PORT }, (info: { port: number }) => {
    console.log(`\n  Lolo AI server → http://localhost:${info.port}`);
    console.log(`  database        ${env.DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`);
    console.log(`  ollama          ${env.OLLAMA_URL} ${ollamaUp ? "✓" : "✗"}`);
    console.log(`  openai base     ${env.APP_URL}/v1\n`);
  });

  // Hot reload opens a WebSocket, which never becomes a Hono request. It is
  // handled on the raw socket instead — the handler redoes the session and
  // ownership checks, because an upgrade that skipped them would be the one
  // route a cookie-less client could walk straight through.
  server.on("upgrade", (req, socket, head) => {
    void handleLiveUpgrade(req, socket, head).catch(() => socket.destroy());
  });
}

// In-flight tracking. A turn can hold a pooled model slot and a transaction for
// a minute; killing the process mid-turn strands both. So shutdown stops
// accepting, waits for what is running, and only then releases the pool and the
// database.
let inFlight = 0;
let draining = false;

async function counted(request: Request): Promise<Response> {
  inFlight += 1;
  try {
    return await app.fetch(request);
  } finally {
    inFlight -= 1;
  }
}

async function drain(): Promise<void> {
  draining = true;
  log.info("draining", { inFlight, timeoutMs: DRAIN_TIMEOUT_MS });

  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (inFlight > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, DRAIN_TICK_MS));
  }
  if (inFlight > 0) {
    log.warn("drain timed out, exiting with requests still running", { inFlight });
  }
}

async function shutdown(signal: string, code = 0): Promise<void> {
  if (draining) return;
  console.log(`\n${signal} — closing.`);

  // Stop the listener first, so nothing new arrives while we wait.
  const listener = server;
  if (listener) {
    await new Promise<void>((resolve) => {
      listener.close(() => resolve());
      // Keep-alive sockets would otherwise hold `close` open for their full
      // idle timeout; a shutdown should not wait that long.
      listener.closeAllConnections?.();
    });
  }

  await drain();

  // Dev servers are long-lived children. Leaving one running would hold a port
  // and a workspace directory open after the server is gone, and the next boot
  // would find a port already taken by a process it does not know about.
  const stopped = await stopAllDev();
  if (stopped) log.info("stopped dev servers", { count: stopped });

  await close();
  process.exit(code);
}

let server: Closeable | undefined;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown(signal));
}

process.on("unhandledRejection", (reason) => {
  log.error("unhandled rejection", { reason: String(reason) });
});

process.on("uncaughtException", (err) => {
  // An uncaught exception leaves the process in an unknown state. Log it with
  // the real stack — which `log.error` redacts only at the top level — and go.
  console.error("[fatal]", err);
  void shutdown("uncaughtException", 1);
});

void boot();
