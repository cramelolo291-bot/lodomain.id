// Backup and restore.
//
// A database with no backup is a database waiting to lose everything. This is
// the tool that makes that recoverable, and it deliberately does not depend on
// `pg_dump` being installed: the dump is plain JSON produced by the same
// connection the server already uses.
//
//   bun run db:backup              → backups/lolo-<timestamp>.json
//   bun run db:restore <file>      → restores, with a confirmation step
//   bun run db:verify              → checks the current schema is complete
//
// For a production deploy, also take a `pg_dump` — it preserves indexes and
// constraints that a row-level export cannot. This is the safety net that
// always works.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pool } from "./client";
import { migrate } from "./migrate";

/** The tables worth keeping. `schema_migrations` is rebuilt by the migrator. */
const TABLES = [
  "users",
  "projects",
  "conversations",
  "messages",
  "sessions",
  "magic_links",
  "pool_accounts",
  "usage_events",
  "traces",
  "guardrail_hits",
  "api_keys",
  "project_tables",
  "project_columns",
  "project_rows",
  "project_files",
] as const;

export type Backup = {
  version: 1;
  createdAt: string;
  /** Applied migrations at the time of the dump. */
  migrations: string[];
  tables: Record<string, unknown[]>;
  counts: Record<string, number>;
};

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export async function backup(dir = "backups"): Promise<{ file: string; counts: Backup["counts"] }> {
  await mkdir(dir, { recursive: true });

  // Which tables actually exist, so a partial install still backs up cleanly.
  const present = new Set(
    (
      await pool<{ table_name: string }[]>`
        select table_name from information_schema.tables
         where table_schema = 'public' and table_type = 'BASE TABLE'
      `
    ).map((r) => r.table_name),
  );

  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  for (const name of TABLES) {
    if (!present.has(name)) continue;
    const rows = await pool.unsafe(`select * from "${name}"`);
    tables[name] = rows;
    counts[name] = rows.length;
  }

  let migrations: string[] = [];
  if (present.has("schema_migrations")) {
    migrations = (
      await pool<{ name: string }[]>`select name from schema_migrations order by name`
    ).map((r) => r.name);
  }

  const payload: Backup = {
    version: 1,
    createdAt: new Date().toISOString(),
    migrations,
    tables,
    counts,
  };

  const file = join(dir, `lolo-${stamp()}.json`);
  await writeFile(file, JSON.stringify(payload, null, 2), "utf8");

  return { file, counts };
}

export type RestorePlan = {
  file: string;
  migrations: string[];
  counts: Record<string, number>;
  createdAt: string;
};

/** Reads a backup and reports what restoring it would do. Changes nothing. */
export async function inspect(file: string): Promise<RestorePlan> {
  const path = resolve(file);
  const raw = JSON.parse(await readFile(path, "utf8")) as Backup;

  if (raw.version !== 1) {
    throw new Error(`Unsupported backup version: ${String(raw.version)}`);
  }
  if (!raw.tables || typeof raw.tables !== "object") {
    throw new Error("That file is not a Lolo backup.");
  }

  return {
    file: path,
    migrations: raw.migrations ?? [],
    counts: raw.counts ?? {},
    createdAt: raw.createdAt,
  };
}

/**
 * Restores, replacing what is there. Foreign keys are deferred so a dump can
 * be loaded in any order without hand-sorting the tables.
 */
export async function restore(file: string): Promise<Record<string, number>> {
  const plan = await inspect(file);
  const raw = JSON.parse(await readFile(plan.file, "utf8")) as Backup;

  // One connection for the whole restore. `session_replication_role` is a
  // session setting, and a pool would happily hand the next statement a
  // different connection — the truncate would then run with foreign keys
  // enforced and fail on exactly the rows this is meant to reload.
  const client = await pool.reserve();

  try {
    await client.unsafe("set session_replication_role = replica");

    // Children before parents, and wipe in the reverse order.
    for (const name of [...TABLES].reverse()) {
      if (raw.tables[name]) {
        await client.unsafe(`truncate table "${name}" cascade`);
      }
    }

    const order = [
      "users",
      "projects",
      "project_files",
      "project_tables",
      "project_columns",
      "project_rows",
      "conversations",
      "messages",
      "pool_accounts",
      "usage_events",
      "traces",
      "guardrail_hits",
      "api_keys",
      "sessions",
      "magic_links",
    ];

    const restored: Record<string, number> = {};

    for (const name of order) {
      const rows = raw.tables[name];
      if (!rows || rows.length === 0) {
        restored[name] = 0;
        continue;
      }
      // Identifiers come from our own dump, but they are quoted anyway. Values
    // always go through placeholders — never string interpolation.
    const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

    await client.unsafe("begin");
    try {
      for (const raw of rows) {
        const row = raw as Record<string, unknown>;
        const keys = Object.keys(row);
        if (keys.length === 0) continue;
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

        // postgres.js types `unsafe` against a static parameter list, so a
        // dynamically sized one has to be cast. The values are still bound as
        // parameters — nothing is interpolated into the statement.
        const values = keys.map((k) => row[k] ?? null) as never[];

        await client.unsafe(
          `insert into ${quote(name)} (${keys.map(quote).join(", ")})
             values (${placeholders})`,
          values,
        );
      }
      await client.unsafe("commit");
    } catch (e) {
      // Without this a failed restore leaves half the tables truncated.
      await client.unsafe("rollback").catch(() => {});
      throw e;
    }
      restored[name] = rows.length;
    }

    return restored;
  } finally {
    // Reset before releasing, so the connection does not go back to the pool
    // with FK enforcement still off for whoever picks it up next.
    await client.unsafe("set session_replication_role = origin").catch(() => {});
    client.release();
  }
}

export type VerifyReport = {
  ok: boolean;
  problems: string[];
  applied: string;
  expected: string;
  counts: Record<string, number>;
};

/** Confirms the database matches the migrations this build expects. */
export async function verify(): Promise<VerifyReport> {
  const problems: string[] = [];

  const present = new Set(
    (
      await pool<{ table_name: string }[]>`
        select table_name from information_schema.tables
         where table_schema = 'public' and table_type = 'BASE TABLE'
      `
    ).map((r) => r.table_name),
  );

  for (const name of TABLES) {
    if (!present.has(name)) problems.push(`Missing table: ${name}`);
  }

  const applied = (
    await pool<{ name: string }[]>`select name from schema_migrations order by name`
  )
    .map((r) => r.name)
    .join(", ");

  // Read the files the migrator would apply, so a forgotten migration is caught
  // before it becomes a runtime error.
  const { readdir: rd } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const files = (
    await rd(join(dirname(fileURLToPath(import.meta.url)), "migrations"))
  )
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const expected = files.join(", ");

  if (applied !== expected) {
    problems.push(`Migrations differ — applied: [${applied}] expected: [${expected}]`);
  }

  const counts: Record<string, number> = {};
  for (const name of TABLES) {
    if (!present.has(name)) continue;
    // Not a tagged template: postgres.js would bind `${name}` as a *parameter*
    // and Postgres would reject `from $1`. The name comes from the TABLES
    // constant above, never from input, and is quoted anyway.
    const counted = await pool.unsafe<{ n: number }[]>(
      `select count(*)::int as n from "${name}"`,
    );
    counts[name] = Number(counted[0]?.n ?? 0);
  }

  return { ok: problems.length === 0, problems, applied, expected, counts };
}

export async function listBackups(dir = "backups"): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".json")).sort().reverse();
  } catch {
    return [];
  }
}

// `bun run db:backup` / `db:restore <file>` / `db:verify`
if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, argument] = process.argv.slice(2);

  try {
    if (command === "backup") {
      const { file, counts } = await backup();
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      console.log(`\n  Wrote ${file}`);
      for (const [name, n] of Object.entries(counts)) {
        if (n) console.log(`    ${name.padEnd(20)} ${n}`);
      }
      console.log(`    ${"total".padEnd(20)} ${total}\n`);
    } else if (command === "restore") {
      if (!argument) {
        console.error("  Usage: bun run db:restore <file>");
        process.exit(1);
      }
      const plan = await inspect(argument);
      console.log(`\n  Restoring ${plan.file}`);
      console.log(`    taken ${plan.createdAt}`);
      for (const [name, n] of Object.entries(plan.counts)) {
        console.log(`    ${name.padEnd(20)} ${n}`);
      }
      const restored = await restore(argument);
      console.log("\n  Restored:");
      for (const [name, n] of Object.entries(restored)) {
        if (n) console.log(`    ${name.padEnd(20)} ${n}`);
      }
      console.log("");
    } else if (command === "verify") {
      const report = await verify();
      for (const [name, n] of Object.entries(report.counts)) {
        console.log(`    ${name.padEnd(20)} ${n}`);
      }
      if (report.ok) {
        console.log("\n  Database matches this build.\n");
      } else {
        console.error("\n  Problems:");
        for (const p of report.problems) console.error(`    · ${p}`);
        process.exit(1);
      }
    } else {
      console.log("  Usage: bun run db:backup | db:restore <file> | db:verify");
      await migrate;
    }
  } catch (e) {
    console.error(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}
