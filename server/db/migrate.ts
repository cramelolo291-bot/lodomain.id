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

/** Each file runs in its own transaction, so a failure never half-applies. */
export async function migrate(log = console.log): Promise<number> {
  await pool.unsafe(TRACKING);

  const applied = new Set(
    (
      await pool<{ name: string }[]>`select name from schema_migrations`
    ).map((r) => r.name),
  );

  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let count = 0;
  for (const name of files) {
    if (applied.has(name)) continue;

    const sql = await readFile(join(dir, name), "utf8");
    await pool.begin(async (tx) => {
      await tx.unsafe(sql);
      await tx`insert into schema_migrations (name) values (${name})`;
    });

    log(`  applied ${name}`);
    count += 1;
  }

  return count;
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
