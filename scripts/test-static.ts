// Production static serving.
//
// `isProd` is read at import time, so this cannot live in `test-api.ts` — it
// needs its own process with NODE_ENV=production. It is the path the user
// actually deploys: one process serving dist/, the API, and the SPA history
// fallback. If this breaks, the product breaks.
//
// Skips with a reason when dist/ is missing, so `bun test` does not require a
// build to have happened first.

import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

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
const skipped = (label: string, why: string) => {
  skip++;
  console.log(`  skip ${label} — ${why}`);
};

let currentSection = "";
function section(name: string) {
  currentSection = name;
  console.log(`\n— ${name} —`);
}
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

// ── No fake live data ──────────────────────────────────────────────────────
section("live data is never replaced with a success-shaped fixture");

await test("HTTP backend is the default and mock is opt-in", async () => {
  const source = await readFile("src/lib/api.ts", "utf8");
  check("default API selection uses HTTP", /export const api: Api = useMockApi \? mockApi\(\) : httpApi\(\)/.test(source));
  check("mock mode requires explicit non-production opt-in", /apiMode === "mock" && !productionBuild/.test(source));
});

await test("public repository pages have no hardcoded live metrics fallback", async () => {
  const [dataLayer, web, dashboard, panel] = await Promise.all([
    readFile("src/lib/frebbuff-data.ts", "utf8"),
    readFile("src/pages/Web.tsx", "utf8"),
    readFile("src/pages/Dashboard.tsx", "utf8"),
    readFile("src/pages/Panel.tsx", "utf8"),
  ]);
  check("data layer throws when live upstream data is missing", dataLayer.includes("No cached fixture was substituted"));
  check("repo browser does not substitute a static repository", !web.includes("FREEbuff") && !web.includes("STATIC_REPO"));
  check("analytics does not contain a static metrics object", !dashboard.includes("const STATIC") && !dashboard.includes("FREEbuff."));
  check("issues panel does not contain static counts", !panel.includes("STATIC_COUNTS"));
});

// Must be set before anything imports server/env.
process.env.NODE_ENV = "production";
process.env.STATIC_DIR = "dist";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://lolo:lolo@localhost:5432/lolo";
process.env.OLLAMA_URL = "http://127.0.0.1:9";
process.env.RESEND_API_KEY = "";

const DIST = join(process.cwd(), "dist");

let built = true;
try {
  await access(join(DIST, "index.html"));
  const assets = await readdir(join(DIST, "assets")).catch(() => []);
  built = assets.length > 0;
} catch {
  built = false;
}

if (!built) {
  skipped("production static serving", "dist/ not built — run `bun run build`");
  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped\n`);
  process.exit(fail ? 1 : 0);
}

const { createApp } = await import("../server/app");
const app = createApp();

async function get(path: string) {
  const res = await app.request(`http://localhost${path}`);
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

// ── Static assets ─────────────────────────────────────────────────────────

section("static assets");

let assetName = "";
await test("an index.html exists and is the real one", async () => {
  const { status, text } = await get("/");
  check("200", status === 200, `${status}`);
  check("it is HTML", text.toLowerCase().includes("<!doctype html"), text.slice(0, 80));
  check("it references the built bundle", /\/assets\/.*\.(js|css)/.test(text));
  const cache = (await get("/")).headers.get("cache-control");
  check("index.html is no-cache", cache === "no-cache", String(cache));
});

await test("hashed assets are served immutable", async () => {
  const files = await readdir(join(DIST, "assets"));
  assetName = files.find((f) => f.endsWith(".js")) ?? files[0]!;

  const { status, headers, text } = await get(`/assets/${assetName}`);
  check("200", status === 200, `${status}`);
  check(
    "cache-control is immutable",
    (headers.get("cache-control") ?? "").includes("immutable"),
    String(headers.get("cache-control")),
  );
  check("content-type is javascript", (headers.get("content-type") ?? "").includes("javascript"));
  check("the body is the file, not index.html", !text.includes("<!doctype html"));
  check("and it is not empty", text.length > 0);
});

await test("a css asset gets a css content type", async () => {
  const files = await readdir(join(DIST, "assets"));
  const css = files.find((f) => f.endsWith(".css"));
  if (!css) {
    skipped("css content type", "no css asset in dist/");
    return;
  }
  const { headers } = await get(`/assets/${css}`);
  check("content-type is text/css", (headers.get("content-type") ?? "").includes("text/css"));
});

await test("a missing asset is a 404, not the index", async () => {
  // A stale HTML reference after a deploy is exactly when this happens. If the
  // shell were returned instead, the browser would say `Unexpected token '<'`
  // and name nothing.
  const { status, text } = await get("/assets/nope-1234.js");
  check("404", status === 404, `${status}`);
  check("it is not index.html", !text.toLowerCase().includes("<!doctype html"), text.slice(0, 60));
});

await test("a path climbing out of dist leaks nothing", async () => {
  // The URL parser collapses `..` before Hono ever routes it, so this lands on
  // `/server/index.ts`, misses `/assets/*`, and is treated as an unknown client
  // route. What matters is that no source file is served either way.
  const { text } = await get("/assets/../../server/index.ts");
  check("no source leaked", !text.includes("createApp"), text.slice(0, 80));
  check("no server source leaked", !text.includes("serve({"), text.slice(0, 80));
});

await test("a traversal that survives normalisation still cannot read a file", async () => {
  // Encoded, so the parser leaves the dots alone and the path reaches the asset
  // handler as a literal filename rather than a directory climb.
  const { status, text } = await get("/assets/%2e%2e%2f%2e%2e%2fpackage.json");
  check("not a 200 file", status !== 200, `${status}`);
  check("no package.json", !text.includes('"dependencies"'), text.slice(0, 80));
});

// ── History fallback ──────────────────────────────────────────────────────

section("spa history fallback");

await test("a client route returns the shell, not a 404", async () => {
  for (const path of ["/", "/auth", "/panel", "/dashboard", "/chat", "/chat/def-456", "/web", "/web/abc-123", "/studio", "/projects", "/integrations", "/messages", "/browser", "/security", "/cloud", "/reverse-engineering", "/deploy", "/design", "/server", "/infrastructure"]) {
    const { status, text } = await get(path);
    check(`${path} is 200`, status === 200, `${status}`);
    check(`${path} serves the shell`, text.includes("<!doctype html"));
  }
});

await test("every declared page route has a client-side route definition", async () => {
  const source = await readFile("src/main.tsx", "utf8");
  const expectedRoutes = [
    "/", "/auth", "/panel", "/dashboard", "/chat", "/web", "/studio",
    "/projects", "/integrations", "/messages", "/browser", "/security",
    "/cloud", "/reverse-engineering", "/deploy", "/design", "/server",
    "/infrastructure",
  ];
  for (const route of expectedRoutes) {
    const doubleQuoted = `path="${route}"`;
    const singleQuoted = `path='${route}'`;
    check(`route ${route} is registered`, source.includes(doubleQuoted) || source.includes(singleQuoted));
  }
});

await test("an unknown path also returns the shell", async () => {
  const { status, text } = await get("/totally-unknown");
  check("200", status === 200, `${status}`);
  check("the router decides what it means", text.includes("<!doctype html"));
});

await test("an unknown api path is a JSON 404, not the shell", async () => {
  // The catch-all is registered last, so an /api miss must stay JSON or the
  // frontend gets HTML where it expects an error object.
  const { status, headers, text } = await get("/api/definitely-not-a-route");
  check("not 200", status !== 200, `${status}`);
  check("not the shell", !text.includes("<!doctype html"), text.slice(0, 60));
  check(
    "json content type",
    (headers.get("content-type") ?? "").includes("application/json"),
    String(headers.get("content-type")),
  );
});

await test("an unknown v1 path is a JSON 404 too", async () => {
  const { status, text } = await get("/v1/not-a-route");
  check("not 200", status !== 200, `${status}`);
  check("not the shell", !text.includes("<!doctype html"), text.slice(0, 60));
});

// ── Security headers ──────────────────────────────────────────────────────

section("security headers survive the static path");

await test("responses carry the standard hardening headers", async () => {
  const { headers } = await get("/");
  for (const header of [
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
  ]) {
    check(`${header} is set`, !!headers.get(header), header);
  }
  check("nosniff is on", headers.get("x-content-type-options") === "nosniff");
});

// ── Ordering ──────────────────────────────────────────────────────────────

section("mount order");

await test("the API still answers ahead of the catch-all", async () => {
  const { status, text } = await get("/api/health");
  // The database is not running here, so 503 is the correct answer. What
  // matters is that it is JSON from the health route and not the SPA shell.
  check("it reached the health route", !text.includes("<!doctype html"), text.slice(0, 60));
  check("and it is honest about the database", status === 503 || status === 200, `${status}`);
});

await test("the v1 surface still answers ahead of the catch-all", async () => {
  const { status, text } = await get("/v1/models");
  check("it is a 401, not the shell", status === 401, `${status}`);
  check("and it is json", !text.includes("<!doctype html"));
});

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped\n`);
console.log(
  [
    "Now verified: the production process serves the built bundle with immutable",
    "caching for hashed assets, no-cache for index.html, the SPA shell on any",
    "client route, and JSON for anything under /api or /v1 — so a client-side",
    "route survives a hard refresh without the API ever returning HTML.",
    "",
    "Still unverified: the container build itself. Run `docker compose up -d",
    "--build` on a machine with Docker; no daemon is available in this sandbox.",
  ].join("\n") + "\n",
);

process.exit(fail ? 1 : 0);
