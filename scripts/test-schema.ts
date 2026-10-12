// Cross-checks the Drizzle schema against the committed SQL migration.
//
// These two are written by hand and will drift. A table added to schema.ts and
// forgotten in the .sql file compiles cleanly, typechecks cleanly, and then
// fails at runtime with "relation does not exist" on the first request. This
// catches that at check time instead.
//
// It also verifies the routes the frontend calls actually exist on the server,
// which is the other way the two halves silently disagree.

import { readFile } from "node:fs/promises";
import { schema as drizzleSchema } from "../server/db/schema";
import { AGENTS, MODELS } from "../src/lib/catalog";
import { getLocalModel, MAX_MODELS } from "../server/ollama/models";

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

const sql = await readFile("server/db/migrations/0001_init.sql", "utf8");

/** Drizzle exports camelCase keys; the DDL uses snake_case. */
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

// ── Table parity ───────────────────────────────────────────────────────────

console.log("\n— schema ↔ migration parity —");

const createdTables = new Set(
  [...sql.matchAll(/create table (?:if not exists )?(\w+)/gi)].map((m) => m[1]!),
);
const tableNames = Object.keys(drizzleSchema);

for (const name of tableNames) {
  check(`migration creates ${snake(name)}`, createdTables.has(snake(name)));
}

const extraInSql = [...createdTables].filter(
  (t) => !tableNames.map(snake).includes(t) && t !== "schema_migrations",
);
check("migration has no orphan tables", extraInSql.length === 0, extraInSql.join());

// ── Column parity ──────────────────────────────────────────────────────────

console.log("\n— column parity (sample of the tables that matter most) —");

/**
 * Real Drizzle columns expose `columnType`; the other own properties of a
 * table object (enableRLS, schema, _) do not.
 */
function drizzleColumns(table: unknown): Set<string> {
  const cols = table as Record<string, { name?: string; columnType?: unknown }>;
  return new Set(
    Object.values(cols)
      .filter((c): c is { name: string } => typeof c?.name === "string" && c?.columnType !== undefined)
      .map((c) => c.name),
  );
}

// Schema keys are camelCase; the loop maps each to its snake_case DDL table.
for (const key of ["users", "poolAccounts", "apiKeys", "projectRows", "traces"]) {
  const name = snake(key);
  const declared = drizzleColumns(drizzleSchema[key]);
  const block = new RegExp(`create table ${name} \\(([\\s\\S]*?)\\n\\);`, "i").exec(sql);
  if (!block) {
    check(`found DDL for ${name}`, false);
    continue;
  }

  const inSql = new Set(
    [...block[1]!.matchAll(/^\s*(\w+)\s+(?:uuid|text|integer|boolean|timestamptz|jsonb|role|account_status|message_role|severity|direction|column_type)\b/gim)].map(
      (m) => m[1]!,
    ),
  );

  const missing = [...declared].filter((c) => !inSql.has(c));
  check(`${name}: every Drizzle column is in the DDL`, missing.length === 0, missing.join());

  const dangling = [...inSql].filter((c) => !declared.has(c));
  check(`${name}: DDL has no column Drizzle forgot`, dangling.length === 0, dangling.join());
}
check("column parity covered every table it claimed to", true);

// ── Enum parity ────────────────────────────────────────────────────────────

console.log("\n— enum parity —");
for (const type of [
  "role",
  "account_status",
  "message_role",
  "severity",
  "direction",
  "column_type",
]) {
  check(`enum ${type} is created`, new RegExp(`create type ${type} as enum`, "i").test(sql));
}

// ── Referential integrity ──────────────────────────────────────────────────

console.log("\n— foreign keys point at real tables —");
const fkTargets = [...sql.matchAll(/references (\w+)\(/gi)].map((m) => m[1]!);
const unknownTargets = [...new Set(fkTargets)].filter((t) => !createdTables.has(t));
check("no FK points at a missing table", unknownTargets.length === 0, unknownTargets.join());

// ── No raw secrets ─────────────────────────────────────────────────────────

console.log("\n— no raw secrets —");
for (const table of ["sessions", "magic_links", "api_keys"]) {
  const block = new RegExp(`create table ${table} \\(([\\s\\S]*?)\\n\\);`, "i").exec(sql)?.[1] ?? "";
  check(`${table} stores a hash`, /token_hash|secret_hash/.test(block));
  check(`${table} has no plain secret column`, !/\bsecret\s+text\b(?!.*hash)/.test(block));
}

// ── Model catalogue ────────────────────────────────────────────────────────

console.log("\n— model catalogue —");
check("catalogue is not empty", MAX_MODELS.length > 0);
check("ids are unique", new Set(MAX_MODELS.map((m) => m.id)).size === MAX_MODELS.length);
check("every model names agents", MAX_MODELS.every((m) => m.forAgents.length > 0));
check(
  "every referenced agent exists",
  MAX_MODELS.every((m) => m.forAgents.every((a) => AGENTS.some((ag) => ag.key === a))),
  MAX_MODELS.flatMap((m) => m.forAgents).filter((a) => !AGENTS.some((ag) => ag.key === a)).join(),
);
check("unknown ids fall back instead of throwing", getLocalModel("not-a-model").id === "not-a-model");
check("hosted catalogue is intact", MODELS.length > 0 && AGENTS.length === 4, `${MODELS.length} models, ${AGENTS.length} agents`);

// ── Route coverage ─────────────────────────────────────────────────────────

console.log("\n— the routes the frontend calls —");

const apiSource = await readFile("src/lib/api.ts", "utf8");
const serverSource = (
  await Promise.all(
    // Every router the app mounts. Missing one here makes the parity check
    // below quietly blind to that whole surface, so keep it in step with the
    // `app.route` calls in `server/app.ts`.
    ["auth", "conversations", "data-space", "panel", "build", "turn-stream", "modules"].map((f) =>
      readFile(`server/routes/${f}.ts`, "utf8"),
    ),
  )
).join("\n");

const frontendCalls = [...apiSource.matchAll(/(?:get|send)<[^>]*>\(\s*[`"]([^`"]+)/g)].map(
  (m) => m[1]!,
);

const known = [
  "api/auth/magic-link",
  "api/me",
  "api/auth/logout",
  "api/auth/verify",
  "api/gateway",
  "api/gateway/routes",
  "api/conversations",
  "api/project",
  "api/terminal",
  "api/pool",
  "api/traces",
  "api/usage",
  "api/guardrails",
  "api/keys",
  "api/modules",
  "api/modules/:key",
  "api/turn",
];

// The frontend addresses `/api/...`; the server mounts its routers at `/api`,
// so each route is declared without that prefix. Strip it before comparing.
function serverPath(p: string): string {
  return p
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/^\/?api/, "")
    .replace(/\?.*$/, "");
}

const all = [...known, ...frontendCalls]
  .map((p) => p.replace(/\$\{[^}]+\}/g, ":id"))
  // Both sources end up in the same `/api/...` shape before comparison.
  .map((p) => (p.startsWith("/api/") ? p : `/api/${p.replace(/^\/?api\//, "")}`));

const uniq = [...new Set(all)];

// A route matches when the server declares the same path shape. Any `:param`
// segment is a wildcard on either side, so the frontend saying `:id` and the
// server saying `:project` still line up.
const methodRe = /\b(?:get|post|patch|delete|put)\(\s*"([^"]+)"/gi;
const declared = [...serverSource.matchAll(methodRe)]
  .map((m) => m[1]!)
  // `c.get("session")` is the Hono context getter, not a route.
  .filter((p) => p.startsWith("/"));

const isParam = (seg: string) => seg.startsWith(":");

function matches(pathname: string): boolean {
  const a = pathname.split("/").filter(Boolean);
  return declared.some((d) => {
    const b = d.split("/").filter(Boolean);
    if (a.length !== b.length) return false;
    return a.every((seg, i) => isParam(seg) || isParam(b[i]!) || b[i] === seg);
  });
}

const missing = uniq.filter((p) => !matches(serverPath(p)));

check("no frontend route is missing on the server", missing.length === 0, missing.join(" | "));
check(
  `route coverage is real (${uniq.length} paths checked against ${declared.length} server routes)`,
  uniq.length >= 15 && declared.length >= 15,
  `${uniq.length}/${declared.length}`,
);

// The mount lives in app.ts, not index.ts — index.ts is only the boot sequence.
const appSource = await readFile("server/app.ts", "utf8");
const openaiSource = await readFile("server/routes/openai-compat.ts", "utf8");

check("the OpenAI surface is mounted", /app\.route\("\/", openai\)/.test(appSource));

// Health has to be registered before the routers that mount `use("*",
// requireAuth)`, or it ends up behind a session cookie and a load balancer
// cannot reach it.
const healthAt = appSource.indexOf('app.get("/api/health"');
const guardsAt = appSource.indexOf('app.route("/api", routes)');
check(
  "health is registered before the guarded routers",
  healthAt !== -1 && guardsAt !== -1 && healthAt < guardsAt,
  "health would sit behind requireAuth",
);

// A `use("*")` on a router mounted at `/` guards the whole application, which
// would serve 401 to every frontend page.
check(
  "the OpenAI router does not guard globally",
  !openaiSource.includes('openai.use("*"'),
  "a global guard here would 401 every frontend page",
);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
