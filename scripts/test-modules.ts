// Module integration and ownership tests against PGlite over a real TCP socket.
// This verifies the actual Hono routes and Drizzle persistence; it never contacts
// configured endpoints, because module settings are metadata until adapters exist.

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFile } from "node:fs/promises";
import { generateToken, hashToken } from "../server/auth/tokens";

const PORT = 55434;
let pass = 0;
let fail = 0;
function check(label: string, condition: boolean, extra = "") {
  if (condition) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label} ${extra}`);
  }
}

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`;
process.env.AUTO_MIGRATE = "false";
process.env.RESEND_API_KEY = "";
process.env.OLLAMA_URL = "http://127.0.0.1:9";
process.env.LOG_LEVEL = "error";

const pg = new PGlite();
await pg.waitReady;
const socket = new PGLiteSocketServer({ db: pg, port: PORT, host: "127.0.0.1" });
await socket.start();

async function teardown() {
  await socket.stop();
  await pg.close();
}

try {
  await pg.exec(await readFile("server/db/migrations/0001_init.sql", "utf8"));
  await pg.exec("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  await pg.exec("insert into schema_migrations (name) values ('0001_init.sql') on conflict do nothing");

  const { createApp } = await import("../server/app");
  const app = createApp();

  async function signIn(email: string) {
    const token = generateToken();
    await pg.query(
      "insert into magic_links (email, token_hash, expires_at) values ($1, $2, now() + interval '15 minutes')",
      [email, hashToken(token)],
    );
    const response = await app.request(`http://localhost/api/auth/verify?token=${token}`);
    const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    check(`sign in ${email}`, response.status === 200 && !!cookie, String(response.status));
    return cookie;
  }

  async function request(path: string, cookie = "", init: RequestInit = {}) {
    const response = await app.request(`http://localhost${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...(init.headers ?? {}),
      },
    });
    const raw = await response.text();
    let body: any = raw;
    try { body = JSON.parse(raw); } catch { /* plain response */ }
    return { status: response.status, body };
  }

  console.log("\n— module authentication and ownership —");
  const anonymous = await request("/api/modules");
  check("anonymous catalog is rejected", anonymous.status === 401, String(anonymous.status));

  const first = await signIn("first@example.test");
  const catalog = await request("/api/modules", first);
  check("authenticated catalog is available", catalog.status === 200, String(catalog.status));
  check("catalog contains all seven modules", catalog.body?.items?.length === 7);
  check("execution is explicitly disabled", catalog.body?.executionEnabled === false);
  check("unconfigured modules are not reported healthy",
    catalog.body?.items?.every((item: any) => item.status === "not_configured" && item.enabled === false));

  const saved = await request("/api/modules/browser", first, {
    method: "PUT",
    body: JSON.stringify({ endpointUrl: "https://browser.example.test/api", enabled: true }),
  });
  check("HTTPS config saves", saved.status === 200, JSON.stringify(saved.body));
  check("saved endpoint remains pending, not fake healthy",
    saved.body?.status === "pending" && saved.body?.executionEnabled === false, JSON.stringify(saved.body));

  const persisted = await request("/api/modules", first);
  const browser = persisted.body?.items?.find((item: any) => item.key === "browser");
  check("saved endpoint persists", browser?.endpointUrl === "https://browser.example.test/api");
  check("persisted status remains pending", browser?.status === "pending");

  const http = await request("/api/modules/security", first, {
    method: "PUT",
    body: JSON.stringify({ endpointUrl: "http://example.test", enabled: true }),
  });
  check("remote HTTP endpoint is refused", http.status === 400, String(http.status));

  const credentials = await request("/api/modules/security", first, {
    method: "PUT",
    body: JSON.stringify({ endpointUrl: "https://user:pass@example.test", enabled: true }),
  });
  check("embedded endpoint credentials are refused", credentials.status === 400, String(credentials.status));

  const second = await signIn("second@example.test");
  const secondMe = await request("/api/me", second);
  check("second cookie resolves to the second account", secondMe.body?.email === "second@example.test", JSON.stringify(secondMe));
  const secondCatalog = await request("/api/modules", second);
  check("second account can read its own catalog", secondCatalog.status === 200, JSON.stringify(secondCatalog));
  const secondBrowser = secondCatalog.body?.items?.find((item: any) => item.key === "browser");
  check("another user cannot see the first user's endpoint", secondBrowser?.endpointUrl === null, JSON.stringify(secondBrowser));
  check("another user has independent defaults", secondBrowser?.status === "not_configured" && secondBrowser?.enabled === false, JSON.stringify(secondBrowser));

  const disabled = await request("/api/modules/browser", first, {
    method: "PUT",
    body: JSON.stringify({ enabled: false }),
  });
  check("disabling a configured endpoint is explicit", disabled.status === 200 && disabled.body?.status === "disabled");

  const deleted = await request("/api/modules/browser", first, { method: "DELETE" });
  check("configuration deletion succeeds", deleted.status === 200 && deleted.body?.status === "not_configured");
  const afterDelete = await request("/api/modules", first);
  check("deleted configuration returns to unconfigured", afterDelete.body?.items?.find((item: any) => item.key === "browser")?.endpointUrl === null);

  console.log(`\n${pass} passed, ${fail} failed\n`);
} catch (error) {
  fail++;
  console.error("FAIL module integration suite threw:", error);
} finally {
  await teardown();
}
process.exit(fail ? 1 : 0);
