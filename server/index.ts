// Process entrypoint. Boots the server; the app itself lives in `app.ts`.
//
//   bun run server        → API on :8787, frontend from dist/
//
// Boot order matters: verify the database is current, repair orphaned pool
// state, then start listening. Failing at boot is better than serving 500s.

import { serve } from "@hono/node-server";
import { app } from "./app";
import { env } from "./env";
import { assertCurrent, migrate } from "./db/migrate";
import { close, ping } from "./db/client";
import { pruneSessions } from "./auth/session";
import { pruneMagicLinks } from "./auth/magic-link";
import { clearExpiredCooldowns, resetOrphans } from "./ollama/pool";
import { isUp } from "./ollama/client";

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
