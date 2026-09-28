// Schema creation, written as plain SQL and applied in order.
//
// This is deliberately not `drizzle-kit push`. The SQL is committed, so the
// exact schema a server ran against is reviewable and reversible, and a fresh
// database can be built with nothing but Postgres and this file.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./client";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "migrations");

const TRACKING = `
  create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  );
`;

/**
 * Arbitrary but fixed key. Two servers booting at once would otherwise both see
 * an unapplied migration and try to run it; `create type` is not idempotent, so
 * the second one dies mid-migration. The lock makes the loser wait, then find
 * the work already done.
 */
const LOCK_KEY = 8_675_309;

/** A connection checked out of the pool, for the whole duration of a lock. */
type Conn = Awaited<ReturnType<typeof pool.reserve>>;

/**
 * Runs `fn` while holding the migration lock, on one dedicated connection.
 *
 * The work happens on that same connection rather than on the pool. A reserved
 * connection that then reaches back into the pool for its own statements needs
 * a second connection to make progress — fine on a big Postgres, fatal on a
 * small pool, and a deadlock waiting to happen on a single-connection backend.
 */
export async function withLock<T>(
  fn: (client: Conn) => Promise<T>,
  timeoutMs = 30_000,
): Promise<T> {
  const client = await pool.reserve();
  const deadline = Date.now() + timeoutMs;

  try {
    for (;;) {
      const [row] = await client`select pg_try_advisory_lock(${LOCK_KEY}) as ok`;
      if (row?.ok) break;
      if (Date.now() > deadline) {
        throw new Error(
          "Another process is holding the migration lock. Wait for it to finish, then retry.",
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    return await fn(client);
  } finally {
    // Released even on a throw: a stranded lock would stop every later boot.
    await client`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
    client.release();
  }
}

/** Each file runs in its own transaction, so a failure never half-applies. */
export async function migrate(log = console.log): Promise<number> {
  return withLock(async (client) => {
    await client.unsafe(TRACKING);

    const applied = new Set(
      (
        await client<{ name: string }[]>`select name from schema_migrations`
      ).map((r) => r.name),
    );

    const files = (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let count = 0;
    for (const name of files) {
      if (applied.has(name)) continue;

      const sql = await readFile(join(dir, name), "utf8");

      // A reserved connection has no `.begin`, so the transaction is driven by
      // hand. On failure the tracking row is rolled back with the DDL, so the
      // next run retries the whole file rather than skipping it.
      await client.unsafe("begin");
      try {
        await client.unsafe(sql);
        await client`insert into schema_migrations (name) values (${name})`;
        await client.unsafe("commit");
      } catch (e) {
        await client.unsafe("rollback").catch(() => {});
        throw e;
      }

      log(`  applied ${name}`);
      count += 1;
    }

    return count;
  });
}

/** Fails loudly if the database is behind. Called during boot. */
export async function assertCurrent(): Promise<void> {
  await pool.unsafe(TRACKING);
  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const counted = await pool<{ count: string }[]>`
    select count(*)::text as count from schema_migrations
  `;
  const done = Number(counted[0]?.count ?? 0);
  if (done < files.length) {
    throw new Error(
      `Database is behind: ${done}/${files.length} migrations applied. Run \`bun run db:migrate\`.`,
    );
  }
}

// `bun run db:migrate` runs this file directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const n = await migrate();
  console.log(
    n === 0 ? "Database is already up to date." : `\nApplied ${n} migration(s).`,
  );
  await pool.end();
}
