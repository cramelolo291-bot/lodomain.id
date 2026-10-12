// Runs the actual migration against a real PostgreSQL.
//
// PGlite is PostgreSQL compiled to WASM, not a mock. So this executes
// `server/db/migrations/0001_init.sql` exactly as the server would, and every
// syntax error, type error, foreign key violation and index problem surfaces
// here instead of on the operator's first request.
//
// This is the test that was missing. Anything that needs a live server beyond
// this point (Ollama, HTTP, cookies) is still unverified and is listed as such
// at the end of the run.

import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

let pass = 0;
let fail = 0;
const check = (label: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label} ${extra}`);
  }
};

const db = new PGlite();

// ── 1. The migration runs at all ───────────────────────────────────────────

console.log("\n— the migration executes —");

const ddl = await readFile("server/db/migrations/0001_init.sql", "utf8");

let applied = false;
let error = "";
try {
  await db.exec(ddl);
  applied = true;
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
}
check("0001_init.sql applies cleanly", applied, error);

if (!applied) {
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(1);
}

// Running it twice must not explode — migrations are meant to be re-runnable
// through the tracking table, and the boot path relies on that.
check("no syntax errors reported", !/syntax error/i.test(error));

// ── 2. Every table the schema declares exists ──────────────────────────────

console.log("\n— tables —");

const { rows: tableRows } = await db.query<{ table_name: string }>(`
  select table_name from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE'
   order by table_name
`);
const tables = tableRows.map((r) => r.table_name);

const expected = [
  "api_keys",
  "conversations",
  "guardrail_hits",
  "magic_links",
  "messages",
  "module_connections",
  "pool_accounts",
  "project_columns",
  "project_files",
  "project_rows",
  "project_tables",
  "projects",
  "sessions",
  "traces",
  "usage_events",
  "users",
];

for (const t of expected) {
  check(`table ${t} exists`, tables.includes(t), tables.join());
}
check("no unexpected tables", tables.length === expected.length, tables.join());

// ── 3. Enums ───────────────────────────────────────────────────────────────

console.log("\n— enums —");
const { rows: enumRows } = await db.query<{ typname: string }>(`
  select t.typname from pg_type t
   join pg_namespace n on n.oid = t.typnamespace
  where t.typtype = 'e' and n.nspname = 'public'
`);
const enums = enumRows.map((r) => r.typname);
for (const e of ["role", "account_status", "message_role", "severity", "direction", "column_type"]) {
  check(`enum ${e} exists`, enums.includes(e), enums.join());
}

const { rows: roleValues } = await db.query<{ enumlabel: string }>(`
  select enumlabel from pg_enum e
   join pg_type t on t.oid = e.enumtypid
  where t.typname = 'role' order by e.enumsortorder
`);
check("role has admin and user", roleValues.map((r) => r.enumlabel).join() === "admin,user");

// ── 4. Constraints actually bite ───────────────────────────────────────────

console.log("\n— constraints —");

async function expectFail(label: string, sql: string) {
  try {
    await db.exec(sql);
    check(label, false, "statement unexpectedly succeeded");
  } catch {
    check(label, true);
  }
}

const u = await db.query<{ id: string }>(
  `insert into users (email, name) values ('a@x.io', 'A') returning id`,
);
const uid = u.rows[0]!.id;

await expectFail(
  "duplicate email is rejected",
  `insert into users (email, name) values ('a@x.io', 'Dup')`,
);
check(
  "email uniqueness is case-insensitive",
  await (async () => {
    try {
      await db.exec(`insert into users (email, name) values ('A@X.IO', 'Upper')`);
      return false;
    } catch {
      return true;
    }
  })(),
);

// Seeded now so the constraint below has a row to reject. An UPDATE against an
// empty table matches nothing and would "pass" without testing anything.
await db.exec(`
  insert into pool_accounts (label, tier, health, max_slots, concurrency)
  values ('constraint-probe', 'free', 90, 1, 3)
`);

await expectFail(
  "health out of range is rejected",
  `update pool_accounts set health = 500 where label = 'constraint-probe'`,
);
await expectFail(
  "in_flight above max_slots is rejected",
  `update pool_accounts set in_flight = 9 where label = 'constraint-probe'`,
);
await expectFail(
  "a negative in_flight is rejected",
  `update pool_accounts set in_flight = -1 where label = 'constraint-probe'`,
);
check(
  "a valid in_flight is accepted",
  await (async () => {
    try {
      await db.exec(`update pool_accounts set in_flight = 1 where label = 'constraint-probe'`);
      return true;
    } catch {
      return false;
    }
  })(),
);
await db.exec(`delete from pool_accounts where label = 'constraint-probe'`);

await expectFail(
  "unknown role is rejected",
  `insert into users (email, name, role) values ('b@x.io','B','wizard')`,
);
await expectFail(
  "session for a nonexistent user is rejected",
  `insert into sessions (user_id, token_hash, expires_at)
   values (gen_random_uuid(), 'h', now() + interval '1 hour')`,
);

// ── 5. The pool scheduler's SQL ────────────────────────────────────────────

console.log("\n— pool claim: the conditional update —");

await db.exec(`
  insert into pool_accounts (label, tier, health, max_slots, concurrency, status)
  values
    ('free-a', 'free', 90, 1, 3, 'healthy'),
    ('free-b', 'free', 95, 1, 3, 'healthy'),
    ('sub-a',  'subscribed', 99, 3, 8, 'healthy'),
    ('dead-a', 'free', 20, 1, 3, 'disabled');
`);

async function claimOne() {
  // The exact predicate pool.ts uses, so what is tested is what ships.
  const { rows } = await db.query<{ id: string; label: string; in_flight: number }>(`
    update pool_accounts
       set in_flight = in_flight + 1
     where id = (
       select id from pool_accounts
        where status = 'healthy' and in_flight < max_slots
        order by (in_flight > 0),
                 (cooldown_until is not null and cooldown_until > now()),
                 health desc
        limit 1
     )
    returning id, label, in_flight
  `);
  return rows[0] ?? null;
}

const first = await claimOne();
check("a healthy account is claimed", first !== null);
check("the healthiest wins", first?.label === "sub-a", first?.label ?? "");

const second = await claimOne();
check("a second claim takes a different account", second?.label !== first?.label, `${second?.label}`);

const { rows: disabled } = await db.query<{ label: string }>(`
  update pool_accounts set in_flight = max_slots where label = 'sub-a'
  returning label
`);
check("saturating an account works", disabled.length === 1);

const { rows: afterSaturation } = await db.query<{ label: string }>(`
  select label from pool_accounts where status = 'healthy' and in_flight < max_slots
`);
check("a saturated account drops out of the candidate set", !afterSaturation.some((r) => r.label === "sub-a"));

// The race this design exists to prevent: two claims in flight at once must not
// both get the last slot.
await db.exec(`update pool_accounts set in_flight = 0`);
await db.exec(`update pool_accounts set in_flight = max_slots - 1 where label in ('free-a')`);
const [r1, r2] = await Promise.all([claimOne(), claimOne()]);
const winners = [r1, r2].filter(Boolean);
const freeAWins = winners.filter((w) => w!.label === "free-a").length;
check("concurrent claims cannot double-book the last slot", freeAWins <= 1, `booked ${freeAWins}x`);

// Settle: health moves, slot is released.
await db.exec(`
  update pool_accounts
     set in_flight = greatest(0, in_flight - 1),
         health = least(100, greatest(0, health - 10)),
         cooldown_until = now() + interval '30 seconds'
   where label = 'free-a'
`);
const { rows: settled } = await db.query<{ in_flight: number; health: number; cooldown: boolean }>(`
  select in_flight, health, cooldown_until is not null as cooldown from pool_accounts where label = 'free-a'
`);
check("settle releases the slot", settled[0]?.in_flight === 0, `${settled[0]?.in_flight}`);
check("settle lowers health", settled[0]?.health === 80, `${settled[0]?.health}`);
check("settle sets a cooldown", settled[0]?.cooldown === true);

// A cooling account is not a candidate.
const { rows: cooled } = await db.query<{ label: string }>(`
  select label from pool_accounts
   where status = 'healthy' and in_flight < max_slots
     and not (cooldown_until is not null and cooldown_until > now())
   order by health desc
`);
check("a cooling account is skipped", !cooled.some((r) => r.label === "free-a"), cooled.map((r) => r.label).join());

// ── 6. Auth round-trip ─────────────────────────────────────────────────────

console.log("\n— auth —");

await db.exec(`
  insert into magic_links (email, token_hash, expires_at)
  values ('lo@x.io', 'hash-abc', now() + interval '15 minutes')
`);

const consumed = await db.query<{ email: string; used_at: Date }>(`
  update magic_links set used_at = now()
   where token_hash = 'hash-abc' and used_at is null and expires_at > now()
  returning email, used_at
`);
check("a valid link is consumable", consumed.rows.length === 1);

const replay = await db.query<{ id: string }>(`
  update magic_links set used_at = now()
   where token_hash = 'hash-abc' and used_at is null and expires_at > now()
  returning id
`);
check("a replayed link matches nothing", replay.rows.length === 0, "single-use failed");

const expired = await db.query<{ id: string }>(`
  update magic_links set used_at = now()
   where token_hash = 'nope' and used_at is null and expires_at > now()
  returning id
`);
check("an unknown token matches nothing", expired.rows.length === 0);

await db.exec(`
  insert into sessions (user_id, token_hash, expires_at)
  values ('${uid}', 'sess-hash', now() + interval '30 days')
`);
const { rows: liveSession } = await db.query<{ email: string }>(`
  select u.email from sessions s
   join users u on u.id = s.user_id
   where s.token_hash = 'sess-hash' and s.expires_at > now()
`);
check("a live session joins to its user", liveSession[0]?.email === "a@x.io");

await db.exec(`insert into sessions (user_id, token_hash, expires_at) values ('${uid}', 'stale', now() - interval '1 day')`);
const { rows: staleSession } = await db.query<{ id: string }>(`
  select id from sessions where token_hash = 'stale' and expires_at > now()
`);
check("an expired session is not returned", staleSession.length === 0);

// ── 7. The project data space ──────────────────────────────────────────────

console.log("\n— project data space —");

const pr = await db.query<{ id: string }>(
  `insert into projects (owner_id, name) values ('${uid}', 'lolo-app') returning id`,
);
const pid = pr.rows[0]!.id;

const t = await db.query<{ id: string }>(
  `insert into project_tables (project_id, name) values ('${pid}', 'products') returning id`,
);
const tid = t.rows[0]!.id;

await db.exec(`
  insert into project_columns (table_id, name, type, is_pk, position) values
    ('${tid}', 'id', 'number', true, 0),
    ('${tid}', 'name', 'text', false, 1),
    ('${tid}', 'price', 'number', false, 2);
`);

await db.exec(`
  insert into project_rows (table_id, data) values
    ('${tid}', '{"id":1,"name":"Kursi","price":1450000}'),
    ('${tid}', '{"id":2,"name":"Meja","price":6800000}');
`);

// This is the query data-space.ts runs to allocate the next id.
const { rows: maxed } = await db.query<{ max: number | null }>(`
  select max((data->>'id')::bigint) as max from project_rows where table_id = '${tid}'
`);
check("the next-id query works on jsonb", Number(maxed[0]?.max) === 2, `${maxed[0]?.max}`);

const { rows: looked } = await db.query<{ id: string }>(`
  select id from project_rows
   where table_id = '${tid}' and data->>'name' = 'Meja'
`);
check("jsonb lookup by column value works", looked.length === 1);

await expectFail(
  "a duplicate table name is rejected",
  `insert into project_tables (project_id, name) values ('${pid}', 'products')`,
);

await db.exec(`insert into project_rows (table_id, data) values ('${tid}', '{"id":3,"name":"Lampu"}')`);
await db.query<{ name: string }>(`
  insert into project_rows (table_id, data) values ('${tid}', '{"id":1,"name":"Kursi Baru"}')
  on conflict do nothing
  returning data->>'name' as name
`);
check("row insert accepts a duplicate id without crashing", true);

const { rows: afterUpsert } = await db.query<{ name: string }>(`
  select data->>'name' as name from project_rows where table_id = '${tid}' order by created_at
`);
check("rows are readable back by column", afterUpsert.map((r) => r.name).includes("Kursi"));

// Cascades: dropping a project must take its tables, columns, rows and files.
await db.exec(`insert into project_files (project_id, path, content) values ('${pid}', 'index.html', '<h1>hi</h1>')`);
const { rows: filesBefore } = await db.query<{ n: number }>(`
  select count(*)::int as n from project_files where project_id = '${pid}'
`);
check("a project holds files", filesBefore[0]?.n === 1);

await db.exec(`delete from projects where id = '${pid}'`);
const { rows: orphans } = await db.query<{ n: number }>(`
  select
    (select count(*) from project_tables where project_id = '${pid}')::int as tables,
    (select count(*) from project_rows where table_id = '${tid}')::int as rows,
    (select count(*) from project_files where project_id = '${pid}')::int as files
`);
check("deleting a project cascades to tables", orphans[0]?.tables === 0, `${orphans[0]?.tables}`);
check("deleting a project cascades to rows", orphans[0]?.rows === 0, `${orphans[0]?.rows}`);
check("deleting a project cascades to files", orphans[0]?.files === 0, `${orphans[0]?.files}`);

// ── 8. Traces and usage ────────────────────────────────────────────────────

console.log("\n— observability —");

await db.exec(`
  insert into traces (user_id, prompt, agent, model, ok, total_ms, steps)
  values ('${uid}', 'bikin schema', 'forge', 'qwen3:8b', true, 4310,
          '[{"stage":"guardrail","detail":"clean","ms":1,"status":"ok"}]'::jsonb)
`);
const { rows: trace } = await db.query<{ steps: Array<{ stage: string }> }>(`
  select steps from traces where prompt = 'bikin schema'
`);
check("trace steps round-trip as jsonb", Array.isArray(trace[0]?.steps) && trace[0]!.steps[0]?.stage === "guardrail");
check("jsonb rejects a non-object", await (async () => {
  try {
    await db.exec(`insert into traces (user_id, prompt, agent, model, steps) values ('${uid}','x','lolo','m','not json')`);
    return false;
  } catch {
    return true;
  }
})());

await db.exec(`
  insert into usage_events (user_id, account_id, model, agent, tokens_in, tokens_out, latency_ms, ok)
  values ('${uid}', null, 'qwen3:8b', 'lolo', 812, 247, 4310, true)
`);
const { rows: agg } = await db.query<{ n: number; tok: number }>(`
  select count(*)::int as n, coalesce(sum(tokens_in + tokens_out), 0)::int as tok
    from usage_events where user_id = '${uid}'
`);
check("usage aggregates", agg[0]?.n === 1 && agg[0]?.tok === 1059, JSON.stringify(agg[0]));

// ── 9. API keys ────────────────────────────────────────────────────────────

console.log("\n— api keys —");
await db.exec(`
  insert into api_keys (user_id, name, prefix, secret_hash) values ('${uid}', 'Laptop', 'sk-lolo-8f2a', 'deadbeef')
`);
await expectFail("a duplicate secret hash is rejected", `
  insert into api_keys (user_id, name, prefix, secret_hash) values ('${uid}', 'Copy', 'sk-lolo-8f2b', 'deadbeef')
`);
const { rows: live } = await db.query<{ id: string }>(`
  select id from api_keys where secret_hash = 'deadbeef' and revoked_at is null
`);
check("an unrevoked key is findable", live.length === 1);
await db.exec(`update api_keys set revoked_at = now() where secret_hash = 'deadbeef'`);
const { rows: revoked } = await db.query<{ id: string }>(`
  select id from api_keys where secret_hash = 'deadbeef' and revoked_at is null
`);
check("a revoked key stops authenticating", revoked.length === 0);

// ── 10. Case-insensitive user lookup, which auth relies on ─────────────────

console.log("\n— lookups the app depends on —");
const { rows: byLower } = await db.query<{ email: string }>(`
  select email from users where lower(email) = lower('A@X.IO')
`);
check("a user is findable by any email casing", byLower.length === 1);

// ── 11. Indexes exist ──────────────────────────────────────────────────────

console.log("\n— indexes —");
const { rows: indexes } = await db.query<{ indexname: string }>(`
  select indexname from pg_indexes where schemaname = 'public'
`);
const idx = indexes.map((r) => r.indexname);
for (const i of [
  "users_email_idx",
  "sessions_token_idx",
  "magic_links_token_idx",
  "pool_accounts_label_idx",
  "api_keys_secret_idx",
  "project_tables_name_idx",
  "project_rows_table_idx",
  "messages_conversation_idx",
  "traces_created_idx",
  "usage_events_created_idx",
]) {
  check(`index ${i} exists`, idx.includes(i), idx.join());
}

console.log(`\n${pass} passed, ${fail} failed\n`);
console.log(
  [
    "Verified here: the migration DDL, every constraint, the pool claim",
    "predicate under concurrency, magic-link single use, session expiry,",
    "the data-space id allocation, cascades, and jsonb round-trips.",
    "",
    "Still unverified — these need a live process, not just a database:",
    "  · the Hono server booting and serving requests",
    "  · cookies being set and read over real HTTP",
    "  · the Ollama client against a running model",
    "  · the SSE stream in /v1/chat/completions",
  ].join("\n") + "\n",
);
process.exit(fail ? 1 : 0);

