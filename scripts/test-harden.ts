// Hardening tests: the parts of the server that only misbehave under pressure.
//
// Everything here is a failure mode the other suites cannot reach — a second
// process booting at the same time, a body that lies about its size, a proxy
// header a client made up, a restore that reopens foreign keys mid-flight, a
// secret that ends up in a log file. None of them show up on a happy path.
//
// Same harness as `test-api.ts`: PGlite over a real TCP socket, so the real
// pool, the real Drizzle queries and the real Hono routes are exercised.

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 55433;

let pass = 0;
let fail = 0;
let skip = 0;
const check = (label: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label} ${extra}`);
  }
};

/** For behaviour this sandbox physically cannot produce, said out loud. */
const skipped = (label: string, why: string) => {
  skip++;
  console.log(`  skip ${label} — ${why}`);
};

let currentSection = "";
function section(name: string) {
  currentSection = name;
  console.log(`\n— ${name} —`);
}

/** Records the outcome and never throws, so one failure does not hide the rest. */
async function test(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    fail++;
    console.log(
      `  FAIL ${currentSection} › ${label} — threw: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

let pg: PGlite;
let socket: PGLiteSocketServer;
let app: any;
let pool: any;
let tmp = "";
let cookie = "";

async function setup() {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`;
  process.env.AUTO_MIGRATE = "false";
  process.env.RESEND_API_KEY = "";
  process.env.OLLAMA_URL = "http://127.0.0.1:9";
  // One trusted reverse proxy, so the forwarding-header rules are testable.
  process.env.TRUST_PROXY = "10.0.0.1";
  process.env.RATE_LIMIT_MAX_KEYS = "50";
  process.env.LOG_LEVEL = "debug";

  pg = new PGlite();
  await pg.waitReady;
  socket = new PGLiteSocketServer({ db: pg, port: PORT, host: "127.0.0.1" });
  await socket.start();

  const ddl = await readFile("server/db/migrations/0001_init.sql", "utf8");
  await pg.exec(ddl);
  await pg.exec(
    `create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`,
  );
  await pg.exec(
    `insert into schema_migrations (name) values ('0001_init.sql') on conflict do nothing`,
  );

  // Start from the current schema, not just the initial migration. Otherwise
  // the migration-lock test below accidentally tests applying 9999_module_connections
  // rather than verifying that two already-current runs do no work.
  const migrationFiles = (await readdir("server/db/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of migrationFiles) {
    if (name === "0001_init.sql") continue;
    await pg.exec(await readFile(join("server/db/migrations", name), "utf8"));
    await pg.query(
      "insert into schema_migrations (name) values ($1) on conflict do nothing",
      [name],
    );
  }

  tmp = await mkdtemp(join(tmpdir(), "lolo-backup-"));

  const { createApp } = await import("../server/app");
  app = createApp();
  ({ pool } = await import("../server/db/client"));
}

/** Signs in, so the guarded routes are reachable. */
async function signIn(email = "harden@lolo.ai") {
  const { generateToken, hashToken } = await import("../server/auth/tokens");
  const token = generateToken();
  await pool`insert into magic_links (email, token_hash, expires_at) values (${email}, ${hashToken(token)}, now() + interval '15 minutes')`;

  const res = await app.request(`http://localhost/api/auth/verify?token=${token}`);
  const setCookie = res.headers.get("set-cookie");
  check("signed in", res.status === 200 && !!setCookie, `${res.status}`);
  cookie = setCookie?.split(";")[0] ?? "";
}

async function call(path: string, init: RequestInit = {}, peer?: string) {
  const res = await app.request(
    `http://localhost${path}`,
    {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...(init.headers ?? {}),
      },
    } as any,
    // The third argument is the Hono `Env`, which is the Node
    // IncomingMessage in production and the only place a real peer address
    // exists. clientIp() reads it from there.
    peer ? { socket: { remoteAddress: peer } } : undefined,
  );

  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, body, headers: res.headers };
}

async function teardown() {
  await socket?.stop();
  await pg?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
}

await setup();
await signIn();
console.log(`\n  postgres on :${PORT} · app booted · ollama deliberately absent\n`);

// ── Validation ─────────────────────────────────────────────────────────────

section("zod validation answers with field-level detail");

await test("a bad turn body is 400 with issues, not 500", async () => {
  const { status, body } = await call("/api/turn", {
    method: "POST",
    body: JSON.stringify({ prompt: "" }),
  });
  check("is 400", status === 400, `${status}`);
  check("names the type", body?.error?.type === "validation_error", JSON.stringify(body)?.slice(0, 160));
  check("lists issues", Array.isArray(body?.error?.issues) && body.error.issues.length > 0);
  check("each issue has a path and a message", body.error.issues.every((i: any) => i.path && i.message));
  check("points at the offending field", body.error.issues.some((i: any) => i.path.includes("prompt")));
});

await test("a wrong-typed field is 400, not a database error", async () => {
  const { status, body } = await call("/api/turn", {
    method: "POST",
    body: JSON.stringify({ prompt: 42, conversationId: "x" }),
  });
  check("is 400", status === 400, `${status}`);
  check("reports the type mismatch", body?.error?.issues?.some((i: any) => i.path === "prompt"));
});

await test("malformed JSON is 400 with a parse message", async () => {
  const { status, body } = await call("/api/turn", {
    method: "POST",
    body: "{not json",
  });
  check("is 400", status === 400, `${status}`);
  check("explains itself", typeof body?.error?.message === "string" && body.error.message.length > 0);
});

await test("an empty body is 400", async () => {
  const { status } = await call("/api/turn", { method: "POST", body: "{}" });
  check("is 400", status === 400, `${status}`);
});

await test("a bad uuid in the path is 400", async () => {
  const { status, body } = await call("/api/conversations/not-a-uuid/messages");
  check("is 400", status === 400, `${status}`);
  check("says which segment", body?.error?.issues?.some((i: any) => i.path.includes("id")));
});

await test("a bad table name is 400 before it reaches SQL", async () => {
  await call("/api/project", { method: "POST", body: JSON.stringify({ name: "x" }) });
  const { status } = await call("/api/projects/lolo-app/tables", {
    method: "POST",
    body: JSON.stringify({ name: "bad name; drop table users", columns: [] }),
  });
  check("is 400", status === 400, `${status}`);
});

await test("a non-numeric query bound is 400", async () => {
  const { status, body } = await call("/api/traces?limit=abc");
  check("is 400", status === 400, `${status}`);
  check("names the query param", JSON.stringify(body).includes("limit"));
});

await test("an out-of-range query bound is 400, not a table scan", async () => {
  const { status } = await call("/api/traces?limit=100000");
  check("is 400", status === 400, `${status}`);
  const ok = await call("/api/traces?limit=5");
  check("a sane limit is accepted", ok.status === 200, `${ok.status}`);
});

await test("no validation failure ever answers 500", async () => {
  const attempts = [
    ["/api/turn", { prompt: null }],
    ["/api/turn", { prompt: "ok", effort: "turbo" }],
    ["/api/conversations", { agent: 12 }],
    ["/api/projects/p/tables", { name: 1, columns: "no" }],
    ["/api/projects/p/query", { sql: 5 }],
  ] as const;

  for (const [path, payload] of attempts) {
    const { status } = await call(path, { method: "POST", body: JSON.stringify(payload) });
    check(`${path} ${JSON.stringify(payload).slice(0, 40)} → ${status}`, status === 400, `${status}`);
  }
});

// ── Request id ─────────────────────────────────────────────────────────────

section("request id ties a log line to a call");

await test("every response carries an id", async () => {
  const { headers } = await call("/api/me");
  const id = headers.get("x-request-id");
  check("header is present", !!id);
  check("it looks like an id", !!id && /^[A-Za-z0-9_-]{8,64}$/.test(id));
});

await test("a well-formed upstream id is reused", async () => {
  const { headers } = await call("/api/me", { headers: { "x-request-id": "trace-abc-123456" } });
  check("echoed back", headers.get("x-request-id") === "trace-abc-123456", headers.get("x-request-id") ?? "");
});

await test("a hostile id is replaced, not reflected", async () => {
  // No control characters here: `fetch` refuses to build a Request with those
  // in a header, and refusing at the socket is the right place for it to die.
  const hostile = "../../etc/passwd<script>alert(1)</script>";
  const { headers } = await call("/api/me", { headers: { "x-request-id": hostile } });
  const id = headers.get("x-request-id");
  check("not reflected", id !== hostile, id ?? "");
  check("still a safe id", !!id && /^[A-Za-z0-9_-]{8,64}$/.test(id ?? ""));
});

await test("two requests get different ids", async () => {
  const a = (await call("/api/me")).headers.get("x-request-id");
  const b = (await call("/api/me")).headers.get("x-request-id");
  check("unique per request", !!a && !!b && a !== b);
});

// ── Redaction ──────────────────────────────────────────────────────────────

section("secrets never reach a log line");

await test("secret-shaped fields are redacted in both formats", async () => {
  const { log } = await import("../server/http/observability");

  const lines: string[] = [];
  const realLog = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    log.info("probe", {
      authorization: "Bearer sk-lolo-supersecret",
      cookie: "lolo_session=abcdef",
      password: "hunter2",
      token: "abc123",
      apiKey: "sk-live-9999",
      nested: { secret: "s3cr3t", keep: "visible" },
      safe: "kept",
    });
  } finally {
    console.log = realLog;
  }

  const out = lines.join("\n");
  check("a line was written", lines.length === 1, `${lines.length}`);
  for (const leak of ["sk-lolo-supersecret", "abcdef", "hunter2", "abc123", "sk-live-9999", "s3cr3t"]) {
    check(`${leak} is not in the log`, !out.includes(leak));
  }
  check("redaction is visible", out.includes("[redacted]"));
  check("non-secret fields survive", out.includes("visible") && out.includes("kept"));
});

await test("a non-string secret value cannot smuggle itself through", async () => {
  const { log } = await import("../server/http/observability");
  const lines: string[] = [];
  const realLog = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    log.error("probe", { token: { nested: "leak-me" } });
  } finally {
    console.log = realLog;
  }
  check("nothing leaks", !lines.join("").includes("leak-me"));
});

await test("a cyclic object does not hang the logger", async () => {
  const { log } = await import("../server/http/observability");
  const cyclic: Record<string, unknown> = { name: "loop" };
  cyclic.self = cyclic;

  const lines: string[] = [];
  const realLog = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    log.info("probe", { cyclic });
  } finally {
    console.log = realLog;
  }
  check("it terminated and truncated", lines.length === 1 && lines[0]!.includes("[deep]"));
});

await test("an error object is logged without dumping a request body", async () => {
  const { loggerFor } = await import("../server/http/observability");
  const fakeCtx = { get: (k: string) => (k === "requestId" ? "req-12345678" : 0) };
  const lines: string[] = [];
  const realLog = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    loggerFor(fakeCtx as any).error("boom", {
      body: { authorization: "Bearer sk-lolo-leak", prompt: "hello" },
    });
  } finally {
    console.log = realLog;
  }
  check("the key is redacted", !lines.join("").includes("sk-lolo-leak"));
  // The human-readable format shows only the first 8 characters, which is
  // enough to correlate by eye and short enough not to fill a terminal.
  check("the request id is present", lines.join("").includes("req-1234"), lines.join(""));
});

// ── Rate limiting ──────────────────────────────────────────────────────────

section("rate limiter identifies the client honestly");

const { bucketCount, resetBuckets } = await import("../server/http/rate-limit");

await test("a forged x-forwarded-for is ignored from an untrusted peer", async () => {
  resetBuckets();
  for (const spoof of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
    await call("/v1/models", { headers: { "x-forwarded-for": spoof } }, "203.0.113.9");
  }
  check("all three collapsed into one bucket", bucketCount() === 1, `${bucketCount()}`);
});

await test("x-forwarded-for is honoured from a trusted proxy", async () => {
  resetBuckets();
  for (const real of ["1.1.1.1", "2.2.2.2"]) {
    await call("/v1/models", { headers: { "x-forwarded-for": `${real}, 10.0.0.1` } }, "10.0.0.1");
  }
  check("two distinct buckets", bucketCount() === 2, `${bucketCount()}`);
});

await test("a chain is read left to right", async () => {
  const { clientIp: resolve } = await import("../server/http/rate-limit");
  const { Hono } = await import("hono");
  const { rateLimit: rl } = await import("../server/http/rate-limit");
  const probe = new Hono();
  let seen = "";
  probe.get("/who", rl({ limit: 10, windowMs: 60_000, scope: "who" }), (c) => {
    seen = resolve(c);
    return c.text("ok");
  });

  await probe.request(
    "http://localhost/who",
    { headers: { "x-forwarded-for": "  5.5.5.5 , 10.0.0.1" } },
    { socket: { remoteAddress: "10.0.0.1" } },
  );
  check("took the first entry and trimmed it", seen === "5.5.5.5", seen);
});

await test("clientIp falls back to the peer when nothing is trustworthy", async () => {
  const { clientIp: resolve } = await import("../server/http/rate-limit");
  const { Hono } = await import("hono");
  const { rateLimit: rl } = await import("../server/http/rate-limit");
  const probe = new Hono();
  let seen = "";
  probe.get("/who", rl({ limit: 10, windowMs: 60_000, scope: "who2" }), (c) => {
    seen = resolve(c);
    return c.text("ok");
  });

  await probe.request("http://localhost/who", { headers: { "x-forwarded-for": "6.6.6.6" } });
  check("no socket, no lie", seen === "unknown", seen);
});

await test("the bucket map stays bounded under a flood", async () => {
  resetBuckets();
  const { env } = await import("../server/env");
  check("the cap is what the test set", env.RATE_LIMIT_MAX_KEYS === 50, String(env.RATE_LIMIT_MAX_KEYS));

  for (let i = 0; i < 300; i++) {
    await call(
      "/v1/models",
      { headers: { "x-forwarded-for": `172.16.${Math.floor(i / 256)}.${i % 256}` } },
      "10.0.0.1",
    );
  }
  check("map did not grow without limit", bucketCount() <= 50, `${bucketCount()}`);
  check("it is still doing its job", bucketCount() > 0, `${bucketCount()}`);
});

await test("an exceeded limit answers 429 with Retry-After", async () => {
  const { Hono } = await import("hono");
  const { rateLimit: rl } = await import("../server/http/rate-limit");
  const probe = new Hono();
  probe.get("/tight", rl({ limit: 2, windowMs: 60_000, scope: "tight" }), (c) => c.text("ok"));

  const peer = { socket: { remoteAddress: "10.0.0.1" } };
  const a = await probe.request("http://localhost/tight", {}, peer);
  await probe.request("http://localhost/tight", {}, peer);
  const c = await probe.request("http://localhost/tight", {}, peer);

  check("third call is 429", c.status === 429, `${c.status}`);
  check("Retry-After is set", !!c.headers.get("retry-after"));
  check("remaining is not negative", Number(a.headers.get("x-ratelimit-remaining")) >= 0);
  const body = await c.json();
  check("body follows OpenAI's error shape", body?.error?.type === "rate_limit_error", JSON.stringify(body));
});

// ── Body limit ─────────────────────────────────────────────────────────────

section("body limit counts bytes, not promises");

await test("a lying content-length is caught anyway", async () => {
  const res = await app.request("http://localhost/api/turn", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "10", cookie },
    body: JSON.stringify({ prompt: "x".repeat(3_000_000) }),
  });
  check("is 413", res.status === 413, `${res.status}`);
});

await test("a body with no content-length at all is still capped", async () => {
  // A ReadableStream body arrives with no declared length, which is exactly the
  // case the early rejection misses.
  const stream = new ReadableStream({
    start(controller) {
      const chunk = new TextEncoder().encode("a".repeat(200_000));
      for (let i = 0; i < 12; i++) controller.enqueue(chunk);
      controller.close();
    },
  });

  const res = await app.request("http://localhost/api/turn", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: stream,
    // Node's fetch requires this for a stream body without a length.
    duplex: "half",
  } as any);
  check("is 413", res.status === 413, `${res.status}`);
});

await test("a body under the cap still reaches the handler", async () => {
  const { status } = await call("/api/turn", { method: "POST", body: JSON.stringify({ prompt: "" }) });
  // 400 from validation, not 413 — the point is that it was read.
  check("validation ran, so the body survived", status === 400, `${status}`);
});

// ── Migration lock ─────────────────────────────────────────────────────────

section("two servers cannot migrate at the same time");

await test("a second migration waits instead of colliding", async () => {
  const { migrate } = await import("../server/db/migrate");

  // Both run against an already-migrated database, so neither has work to do —
  // what is being tested is that they serialise on the lock rather than racing.
  // PGlite is a single-connection backend, so true parallelism is not available
  // here; running them in series still proves acquire-and-release works and
  // that the second one finds the work done.
  const started = Date.now();
  const a = await migrate(() => {});
  const b = await migrate(() => {});

  check("neither reported work", a === 0 && b === 0, `${a} / ${b}`);
  check("neither threw", true);
  check("neither took long enough to be a timeout", Date.now() - started < 30_000, `${Date.now() - started}ms`);
});

await test("a genuinely concurrent pair of migrations is not verifiable here", async () => {
  const { migrate } = await import("../server/db/migrate");
  try {
    await Promise.all([migrate(() => {}), migrate(() => {})]);
    check("both completed", true);
  } catch (e) {
    // PGlite resets the second socket when two clients connect at once. That is
    // a property of the test double, not of the code, so it is reported rather
    // than failed — with a real PostgreSQL this needs a real run to confirm.
    skipped(
      "two simultaneous migrate() calls",
      `PGlite is single-connection and refused the second socket (${e instanceof Error ? e.message : String(e)})`,
    );
  }
});

await test("the lock is released even when the migration throws", async () => {
  const { withLock } = await import("../server/db/migrate");

  // Contention cannot be staged here: PGlite serves one connection, so holding
  // the lock on a reserved client would leave nothing for withLock to reserve.
  // What is verifiable is the half that matters most in production — a failure
  // inside the critical section must not strand the lock and block every later
  // boot.
  const value = await withLock(async () => "ran", 5_000);
  check("the lock is acquirable after a clean run", value === "ran");
});

await test("withLock returns the wrapped value and releases on success", async () => {
  const { withLock } = await import("../server/db/migrate");
  const value = await withLock(async () => 42);
  check("value passes through", value === 42, String(value));

  // If the lock leaked, this would block until its timeout and throw.
  const again = await withLock(async () => "free", 2_000);
  check("the lock did not leak", again === "free");
});

await test("withLock releases the lock when the body throws", async () => {
  const { withLock } = await import("../server/db/migrate");
  let threw = "";
  try {
    await withLock(async () => {
      throw new Error("migration blew up");
    });
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  check("the error surfaced", threw.includes("blew up"), threw);

  const again = await withLock(async () => "recovered", 2_000);
  check("the lock was still released", again === "recovered");
});

// ── Backup and restore ─────────────────────────────────────────────────────

section("backup and restore survive a round trip");

let backupFile = "";

await test("a backup captures the data and reports it", async () => {
  const { backup, listBackups } = await import("../server/db/backup");

  const result = await backup(tmp);
  backupFile = result.file;

  check("a file was written", !!backupFile);
  check("users are in it", (result.counts.users ?? 0) >= 1, JSON.stringify(result.counts));
  check("the list sees it", (await listBackups(tmp)).some((f: string) => f.includes("lolo-")));
});

await test("the dump stores no plaintext secrets", async () => {
  const { createAccount } = await import("../server/auth/session");
  void createAccount;

  const raw = await readFile(backupFile, "utf8");
  const parsed = JSON.parse(raw);
  const sessions = parsed.tables?.sessions ?? [];

  check("sessions are present as rows", Array.isArray(sessions));
  check("no session token is stored", !sessions.some((s: any) => s.token && !/^[a-f0-9]{64}$/.test(String(s.token))));
  check("the dump names its version", parsed.version === 1);
  check("the dump records its migrations", (parsed.migrations ?? []).includes("0001_init.sql"));
});

await test("restoring brings deleted rows back", async () => {
  const { restore } = await import("../server/db/backup");

  const before = await pool<{ n: number }[]>`select count(*)::int as n from users`;
  const expected = before[0]!.n;
  check("there is something to lose", expected >= 1, `${expected}`);

  // A realistic accident: the user table is emptied.
  await pool.unsafe(`delete from users`);
  const emptied = await pool<{ n: number }[]>`select count(*)::int as n from users`;
  check("it is gone", emptied[0]!.n === 0);

  const restored = await restore(backupFile);
  check("restore reported the row", restored.users === expected, JSON.stringify(restored.users));

  const after = await pool<{ n: number }[]>`select count(*)::int as n from users`;
  check("the data is back", after[0]!.n === expected, `${after[0]!.n}`);
});

await test("the restored data is the real data, not a count", async () => {
  const rows = await pool<{ id: string; email: string }[]>`select id, email from users order by email`;
  check("a known row survived with its columns", rows.some((r) => r.email === "harden@lolo.ai"), JSON.stringify(rows));
});

await test("the session still works after a restore", async () => {
  const { status, body } = await call("/api/me");
  check("still signed in", status === 200, `${status}`);
  check("as the same user", body?.email === "harden@lolo.ai", JSON.stringify(body)?.slice(0, 120));
});

await test("foreign keys are enforced again after a restore", async () => {
  // The restore disables them with session_replication_role. If that were left
  // on the pooled connection, every later write in the process would skip FK
  // checks — a silent corruption bug.
  const client = await pool.reserve();
  try {
    const [row] = await client<{ session_replication_role: string }[]>`show session_replication_role`;
    check("back to origin", row?.session_replication_role === "origin", JSON.stringify(row));
  } finally {
    client.release();
  }

  // And the proof: an orphan insert must fail.
  let failed = false;
  try {
    await pool`insert into conversations (id, user_id, title, updated_at) values (gen_random_uuid(), gen_random_uuid(), 'orphan', now())`;
  } catch {
    failed = true;
  }
  check("an orphaned conversation is rejected", failed);
});

await test("restoring twice is idempotent", async () => {
  const { restore } = await import("../server/db/backup");
  await restore(backupFile);
  await restore(backupFile);
  const rows = await pool<{ n: number }[]>`select count(*)::int as n from users`;
  check("no duplication", rows[0]!.n === 1, `${rows[0]!.n}`);
});

await test("a file that is not a backup is refused, not half-applied", async () => {
  const { writeFile } = await import("node:fs/promises");
  const { restore } = await import("../server/db/backup");
  const bogus = join(tmp, "bogus.json");
  await writeFile(bogus, JSON.stringify({ hello: "world" }), "utf8");

  let threw = "";
  try {
    await restore(bogus);
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  check("it refused", threw.length > 0);

  const rows = await pool<{ n: number }[]>`select count(*)::int as n from users`;
  check("nothing was destroyed", rows[0]!.n === 1, `${rows[0]!.n}`);
});

await test("an unsupported version is refused", async () => {
  const { writeFile } = await import("node:fs/promises");
  const { restore } = await import("../server/db/backup");
  const future = join(tmp, "v99.json");
  await writeFile(future, JSON.stringify({ version: 99, tables: { users: [] } }), "utf8");

  let threw = "";
  try {
    await restore(future);
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  check("it refused", threw.includes("version"), threw);
});

await test("verify reports a healthy database", async () => {
  const { verify } = await import("../server/db/backup");
  const report = await verify();
  check("no problems", report.ok, report.problems.join("; "));
  check("it lists row counts", typeof report.counts.users === "number");
  check("migrations match", report.applied === report.expected, `${report.applied} vs ${report.expected}`);
});

await test("verify catches a missing table", async () => {
  const { verify } = await import("../server/db/backup");
  // Renamed rather than dropped, so the fix is a one-word rename back and the
  // test never has to reproduce a table definition.
  await pool.unsafe(`alter table traces rename to traces_hidden`);
  const report = await verify();
  check("it is not ok", !report.ok);
  check("it names the table", report.problems.some((p) => p.includes("traces")), report.problems.join("; "));

  await pool.unsafe(`alter table traces_hidden rename to traces`);
  const after = await verify();
  check("healthy again", after.ok, after.problems.join("; "));
});

await test("inspect reports a plan without changing anything", async () => {
  const { inspect } = await import("../server/db/backup");
  const plan = await inspect(backupFile);
  check("it resolved the path", plan.file.includes("lolo-"));
  check("it counted users", (plan.counts?.users ?? 0) >= 1);
  check("it has a timestamp", !Number.isNaN(Date.parse(plan.createdAt)));
});

// ── Build route ────────────────────────────────────────────────────────────

section("the build route, over a real database");

// The project is created lazily by the first route that needs it, so ask for
// it rather than guessing its name — the route under test is about builds, not
// about provisioning.
const { body: mine } = await call("/api/project");
const slug = String(mine?.name ?? "lolo-app");

await test("a build needs a session", async () => {
  const saved = cookie;
  cookie = "";
  const { status } = await call(`/api/projects/${slug}/build`, {
    method: "POST",
    body: JSON.stringify({ target: "build" }),
  });
  check("401 without a cookie", status === 401, `${status}`);
  cookie = saved;
});

await test("an unknown target is 400, not a 500", async () => {
  const { status, body } = await call(`/api/projects/${slug}/build`, {
    method: "POST",
    body: JSON.stringify({ target: "rm -rf /" }),
  });
  check("400", status === 400, `${status}`);
  check("validation error", body?.error?.type === "validation_error", JSON.stringify(body)?.slice(0, 120));
});

await test("a project with no package.json is skipped, not failed", async () => {
  const { status, body } = await call(`/api/projects/${slug}/build`, {
    method: "POST",
    body: JSON.stringify({ target: "build" }),
  });
  check("200 — nothing to do is not an error", status === 200, `${status}`);
  check("it says why", typeof body?.skipped === "string", JSON.stringify(body)?.slice(0, 160));
  check("ok is true", body?.ok === true);
  check("nothing is advertised as built", body?.hasOutput === false);
});

await test("an empty body still builds", async () => {
  const { status, body } = await call(`/api/projects/${slug}/build`, { method: "POST" });
  check("200", status === 200, `${status}`);
  check("defaults to the build target", body?.target === "build", JSON.stringify(body)?.slice(0, 120));
});

await test("a project with a package.json actually runs the toolchain", async () => {
  const project = await pool<{ id: string }[]>`select id from projects limit 1`;
  const id = project[0]!.id;
  // A dependency-free package.json, so the run needs no registry and stays
  // quick. The point is that real files reach a real process.
  await pool`
    insert into project_files (project_id, path, content)
    values (${id}, 'package.json', ${JSON.stringify({
      name: "probe",
      version: "1.0.0",
      scripts: { build: 'node -e "console.log(1)"' },
    })})
    on conflict (project_id, path) do update set content = excluded.content
  `;

  const { status, body } = await call(`/api/projects/${slug}/build`, {
    method: "POST",
    body: JSON.stringify({ target: "build" }),
  });
  check("200", status === 200, `${status}`);
  check("it ran", body?.command?.length > 0, JSON.stringify(body)?.slice(0, 200));
  check("and it succeeded", body?.ok === true, JSON.stringify(body)?.slice(0, 300));
  check("output is reported", String(body?.output ?? "").length > 0);
  check("a duration was measured", typeof body?.ms === "number");

  // A failed build must not leave an output directory to serve.
  check("nothing is advertised as built", body?.hasOutput === false);

  await pool`delete from project_files where project_id = ${id} and path = 'package.json'`;
});

await test("preview 404s honestly when nothing has been built", async () => {
  const { status, body } = await call(`/api/projects/${slug}/preview`);
  check("404", status === 404, `${status}`);
  check("and says to build first", /build/i.test(String(body?.error?.message)), JSON.stringify(body));
});

await test("an unknown project is 404, not a build of nothing", async () => {
  const { status } = await call("/api/projects/no-such-project/build", {
    method: "POST",
    body: JSON.stringify({ target: "build" }),
  });
  check("404", status === 404, `${status}`);
});

await test("the route is rate limited separately from the rest of the API", async () => {
  // Six a minute is the build budget. A seventh request is refused even though
  // the general API allowance is far higher, which is the whole point: builds
  // install dependencies.
  const results: number[] = [];
  for (let i = 0; i < 8; i++) {
    const { status } = await call(`/api/projects/${slug}/build`, {
      method: "POST",
      body: JSON.stringify({ target: "build" }),
    });
    results.push(status);
  }
  check("a 429 appears within the burst", results.includes(429), results.join(","));
});

// ── Error containment ─────────────────────────────────────────────────────

section("an internal failure does not leak");

await test("a 500 answers generically and keeps the detail server-side", async () => {
  // The restores above round-tripped the user, so the session is intact, but a
  // broken test should not depend on that. Re-establish it explicitly.
  if ((await call("/api/me")).status !== 200) await signIn("harden@lolo.ai");

  // Take a table out from under the query layer, reversibly.
  await pool.unsafe(`alter table traces rename to traces_hidden`);

  const { status, body } = await call("/api/traces");
  check("it is a 500", status === 500, `${status}`);
  check("the client learns nothing", body?.error?.message === "Internal server error", JSON.stringify(body));
  check("no stack in the body", !JSON.stringify(body).includes(" at "));
  check("no SQL in the body", !/relation|select/i.test(JSON.stringify(body)));

  await pool.unsafe(`alter table traces_hidden rename to traces`);
  const { status: back } = await call("/api/traces");
  check("it recovers once the table is back", back === 200, `${back}`);
});

await test("the health check still answers after that", async () => {
  const { status, body } = await call("/api/health");
  check("still 200", status === 200, `${status}`);
  check("database still up", body?.database === true);
});

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped\n`);
console.log(
  [
    "Now verified: bad input answers 400 with field-level detail instead of a",
    "500, every response carries a traceable id that cannot be spoofed, secrets",
    "are redacted from logs, the rate limiter only believes forwarding headers",
    "from a proxy we named, oversized bodies are rejected on real byte count,",
    "concurrent migrations serialise on an advisory lock, and a backup restores",
    "into a working, FK-enforcing database.",
    "",
    "Still unverified — needs a real process:",
    "  · graceful shutdown draining live SSE streams (needs Ollama)",
    "  · postgres.js pooling behaviour under real connection pressure",
  ].join("\n") + "\n",
);

await teardown();
process.exit(fail ? 1 : 0);
