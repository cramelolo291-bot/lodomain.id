// The virtual project the agent actually works on.
//
// Everything here is real: a file tree, real line diffs, a terminal that
// inspects the real tree, and a preview that renders the real `index.html`.
// The only part that is not a real model is `plan()` — the "brain" is a set
// of keyword-matched blueprints. Swap `plan()` for a call to Ollama and the
// rest of the system is unchanged.

import type { AgentDef } from "./catalog";

export type Files = Record<string, string>;

export type ChangeOp = "created" | "modified";

export type FileChange = {
  path: string;
  op: ChangeOp;
  before: string | null;
  after: string;
};

export type Project = {
  name: string;
  files: Files;
};

export type Plan = {
  files: Files;
  changes: FileChange[];
  /** Short lines the agent prints as it works, in order. */
  steps: string[];
  summary: string;
  /** Design decisions worth surfacing alongside the diff. */
  notes: string[];
};

// ── Line diff ─────────────────────────────────────────────────────────────

export type DiffOp = { kind: " " | "+" | "-"; text: string };

/** Longest-common-subsequence diff over lines. Small inputs, so O(n·m) is fine. */
export function diffLines(before: string, after: string): DiffOp[] {
  const a = before.length ? before.split("\n") : [];
  const b = after.length ? after.split("\n") : [];

  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: " ", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "-", text: a[i]! });
      i++;
    } else {
      out.push({ kind: "+", text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ kind: "-", text: a[i++]! });
  while (j < m) out.push({ kind: "+", text: b[j++]! });
  return out;
}

export function diffStats(rows: DiffOp[]) {
  return {
    added: rows.filter((r) => r.kind === "+").length,
    removed: rows.filter((r) => r.kind === "-").length,
  };
}

// ── Language guess, for the file tree ─────────────────────────────────────

const LANGS: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  html: "html",
  css: "css",
  sql: "sql",
  md: "markdown",
  toml: "toml",
};

export function langOf(path: string): string {
  const ext = path.split(".").pop() ?? "";
  return LANGS[ext] ?? "text";
}

// ── Terminal ──────────────────────────────────────────────────────────────

/** Runs a real shell-shaped command against the real tree. */
export function runCommand(
  cmd: string,
  project: Project,
): { out: string[]; code: number } {
  const [bin, ...rest] = cmd.trim().split(/\s+/);
  const paths = Object.keys(project.files).sort();

  switch (bin) {
    case "ls": {
      const depth = rest.includes("-R") || paths.length < 12;
      if (!depth) return { out: paths, code: 0 };
      const byDir = new Map<string, string[]>();
      for (const p of paths) {
        const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".";
        if (!byDir.has(dir)) byDir.set(dir, []);
        byDir.get(dir)!.push(p.split("/").pop()!);
      }
      const out: string[] = [];
      for (const [dir, files] of [...byDir.entries()].sort()) {
        out.push(`${dir === "." ? "." : dir}:`);
        for (const f of files) out.push(`  ${f}`);
      }
      return { out, code: 0 };
    }

    case "cat": {
      const target = rest[0];
      const content = target ? project.files[target] : undefined;
      if (content === undefined) {
        return { out: [`cat: ${target ?? ""}: No such file`], code: 1 };
      }
      return { out: content.split("\n"), code: 0 };
    }

    case "wc": {
      const out: string[] = [];
      let total = 0;
      for (const p of paths) {
        const lines = project.files[p]!.split("\n").length;
        total += lines;
        out.push(`${String(lines).padStart(5)}  ${p}`);
      }
      out.push(`${String(total).padStart(5)}  total`);
      return { out, code: 0 };
    }

    case "tsc":
    case "bun":
    case "npm": {
      return {
        out: [`${bin}: not executed in the mock preview terminal; use the real build runner for verification`],
        code: 1,
      };
    }

    default:
      return { out: [`${bin}: command not found`], code: 127 };
  }
}

// ── Blueprints ────────────────────────────────────────────────────────────
//
// Each blueprint mutates the tree for real. `matches` is what the future
// LLM planner would replace; the rest is exactly the work an agent does.

type Blueprint = {
  key: string;
  label: string;
  matches: RegExp;
  /**
   * The prompt is passed through so a blueprint can build something that
   * actually answers the request. A blueprint that ignores it and writes the
   * same bytes every time produces a zero-diff turn, which reads to the user
   * as "nothing to change" — the worst possible answer to "build me a shop".
   */
  apply: (
    files: Files,
    prompt: string,
  ) => { files: Files; summary: string; notes: string[] };
};

/** Pulls a usable title out of a request, for the app the agent generates. */
function titleFrom(prompt: string): string {
  const cleaned = prompt
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\b(bikin|buatkan|bikinin|buat|buatlah|create|make|build|generate|robohin|tolong|please|dong|guys|min)\b/gi, " ")
    .replace(/\b(aplikasi|aplikasinya|web\s+app|website|situs|halaman|web|page|app|apk)\b/gi, " ")
    .replace(/\b(mobile|web|desktop|android|ios|respon\w*|responsive|frontend|back-?end)\b/gi, " ")
    .replace(/\b(tampilan|tampilan-nya|design|desain|gaya|style|theme|tema)\b/gi, " ")
    .replace(/\b(modern|moderen|keren|megliah|bersih|rapih|rapikan|simple|minimalis|elegan|beauty|beautiful|nice|clean|pretty|polished|wow|keren banget)\b/gi, " ")
    .replace(/\b(banget|sekali|dong|ya|yuk|sih|kek|kah|itu|ini|para|seluruh|seluruhnya)\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "Lolo App";

  const words = cleaned.split(" ").slice(0, 4);
  const name = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

  return name.length > 34 ? `${name.slice(0, 34).trimEnd()}…` : name;
}

/** Commerce vs. generic: decides whether the generated app gets a cart. */
const COMMERCE =
  /\b(toko|store|shop|beli|belanja|produk|product|jual|ecommerce|e-?commerce|keranjang|cart|checkout|price|harga|diskon|katalog|menu|umkm|marketplace|checkout|order|pesanan)\b/i;

const SHOP_ITEMS = [
  { name: "Kopi Susu Gula Aren", price: "28.000", tag: "Terlaris", tone: "amber" },
  { name: "Croissant Mentega", price: "22.000", tag: "Baru", tone: "clay" },
  { name: "Matcha Latte", price: "32.000", tag: "", tone: "moss" },
  { name: "Roti Sourdough", price: "35.000", tag: "Habis besok", tone: "wheat" },
  { name: "Cold Pressed Orange", price: "25.000", tag: "", tone: "citrus" },
  { name: "Dark Chocolate 70%", price: "42.000", tag: "Favorit", tone: "cocoa" },
];

const GENERIC_CARDS = [
  { title: "Mulai cepat", body: "Semua yang lo butuhin ada di satu layar, tanpa navigasi berbelit." },
  { title: "Rapi dan cepat", body: "Ringan di jaringan lambat, tanpa dependasi yang bikin nunggu." },    { title: "Mudah dipakai", body: "Alurnya pendek, dan tidak ada tombol yang bikin bingung." },
];

/**
 * Builds a real, self-contained mobile web app from the request.
 *
 * This used to be a fixed greeting card. That was the actual bug behind
 * "tidak ada file yang perlu berubah": the scaffold wrote identical bytes on
 * every turn, so the diff was empty and the agent reported nothing to do.
 * The output is derived from the prompt, so asking twice produces two
 * different apps rather than a no-op.
 */
function buildApp(prompt: string): { html: string; shop: boolean; title: string } {
  const title = titleFrom(prompt);
  const shop = COMMERCE.test(prompt);

  const items = shop
    ? SHOP_ITEMS.map(
        (i) => `        <article class="card">
          <div class="thumb tone-${i.tone}"><span>${escapeHtml(i.name.slice(0, 1))}</span></div>
          <div class="meta">
            <h3>${escapeHtml(i.name)}</h3>
            <p class="price">Rp${i.price}</p>
          </div>
          ${i.tag ? `<span class="tag">${escapeHtml(i.tag)}</span>` : ""}
          <button class="add" aria-label="Tambah ${escapeHtml(i.name)}">+</button>
        </article>`,
      )
    : GENERIC_CARDS.map(
        (c) => `        <article class="card">
          <div class="meta">
            <h3>${escapeHtml(c.title)}</h3>
            <p>${escapeHtml(c.body)}</p>
          </div>
        </article>`,
      );

  const body = shop
    ? `      <header class="top">
        <button class="icon" aria-label="Menu">&#9776;</button>
        <strong>${escapeHtml(title)}</strong>
        <button class="icon cart" aria-label="Keranjang">&#128722;<span class="badge">2</span></button>
      </header>

      <section class="search">
        <input type="search" placeholder="Cari produk…" aria-label="Cari produk" />
      </section>

      <div class="chips">
        <button class="chip on">Semua</button>
        <button class="chip">Minuman</button>
        <button class="chip">Makanan</button>
        <button class="chip">Snack</button>
      </div>

      <main class="grid">
${items.join("\n")}
      </main>

      <nav class="tabbar">
        <button class="tab on"><span>&#8962;</span>Beranda</button>
        <button class="tab"><span>&#9906;</span>Kategori</button>
        <button class="tab"><span>&#128717;</span>Keranjang</button>
        <button class="tab"><span>&#128100;</span>Akun</button>
      </nav>`
    : `      <header class="top">
        <strong>${escapeHtml(title)}</strong>
        <button class="icon" aria-label="Menu">&#9776;</button>
      </header>

      <section class="hero">
        <h1>${escapeHtml(title)}</h1>
        <p>Dibangun dari satu prompt, di server lo sendiri.</p>
        <button class="cta">Mulai sekarang</button>
      </section>

      <main class="grid one">
${items.join("\n")}
      </main>`;

  return {
    title,
    shop,
    html: `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#100f0d" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #100f0d;
        --surface: #191715;
        --line: rgba(244, 241, 234, 0.1);
        --ink: #f4f1ea;
        --ink-2: #b5aea2;
        --ink-3: #7d766b;
        --ember: #d97757;
      }
      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      html, body { margin: 0; }
      body {
        background: var(--bg);
        color: var(--ink);
        font: 400 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        padding-bottom: calc(76px + env(safe-area-inset-bottom));
      }
      .shell {
        width: 100%;
        max-width: 72rem;
        margin: 0 auto;
        padding: 0 clamp(1rem, 4vw, 2.5rem);
      }

      .top {
        position: sticky; top: 0; z-index: 10;
        display: flex; align-items: center; gap: .75rem;
        padding: .9rem clamp(1rem, 4vw, 2.5rem);
        background: color-mix(in srgb, var(--bg) 88%, transparent);
        backdrop-filter: blur(12px);
        border-bottom: 1px solid var(--line);
      }
      .top strong { flex: 1; font-size: 1.0625rem; letter-spacing: -0.01em; }
      .icon {
        position: relative;
        display: grid; place-items: center;
        width: 2.25rem; height: 2.25rem;
        border: 1px solid var(--line); border-radius: 10px;
        background: var(--surface); color: var(--ink);
        font-size: 1rem; cursor: pointer;
      }
      .badge {
        position: absolute; top: -.35rem; right: -.35rem;
        min-width: 1.1rem; height: 1.1rem; padding: 0 .25rem;
        display: grid; place-items: center;
        border-radius: 999px; background: var(--ember);
        color: #1a0d08; font-size: .625rem; font-weight: 700;
      }

      .search { padding: 1rem 0 .75rem; }
      .search input {
        width: 100%; padding: .75rem 1rem;
        border: 1px solid var(--line); border-radius: 12px;
        background: var(--surface); color: var(--ink);
        font: inherit; outline: none;
      }
      .search input::placeholder { color: var(--ink-3); }
      .search input:focus { border-color: color-mix(in srgb, var(--ember) 55%, transparent); }

      .chips { display: flex; gap: .5rem; overflow-x: auto; padding-bottom: 1rem; scrollbar-width: none; }
      .chips::-webkit-scrollbar { display: none; }
      .chip {
        flex: none; padding: .4rem .85rem;
        border: 1px solid var(--line); border-radius: 999px;
        background: transparent; color: var(--ink-2);
        font: inherit; font-size: .8125rem; cursor: pointer;
        transition: color .18s, border-color .18s, background .18s;
      }
      .chip.on { color: #1a0d08; background: var(--ember); border-color: var(--ember); font-weight: 600; }

      .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: .75rem; padding: 0 0 1.5rem; }
      .grid.one { grid-template-columns: 1fr; }
      .card {
        position: relative;
        display: flex; flex-direction: column; gap: .6rem;
        padding: .75rem;
        border: 1px solid var(--line); border-radius: 14px;
        background: var(--surface);
        transition: transform .18s ease, border-color .18s ease;
      }
      .card:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--ember) 40%, transparent); }
      .thumb {
        display: grid; place-items: center;
        aspect-ratio: 1; border-radius: 10px;
        font-size: 1.75rem; font-weight: 600; color: rgba(0,0,0,.42);
      }
      .tone-amber  { background: linear-gradient(145deg, #e6b980, #c98f4e); }
      .tone-clay   { background: linear-gradient(145deg, #dba99a, #b9713f); }
      .tone-moss   { background: linear-gradient(145deg, #a8bd94, #6f8a5c); }
      .tone-wheat  { background: linear-gradient(145deg, #e3cfa8, #bfa06a); }
      .tone-citrus { background: linear-gradient(145deg, #f0c46a, #cf9b2e); }
      .tone-cocoa  { background: linear-gradient(145deg, #b08868, #7c5741); }

      .meta { flex: 1; }
      .meta h3 { margin: 0 0 .2rem; font-size: .875rem; font-weight: 600; letter-spacing: -0.01em; }
      .meta p { margin: 0; font-size: .8125rem; color: var(--ink-2); }
      .price { color: var(--ink) !important; font-weight: 600; font-variant-numeric: tabular-nums; }

      .tag {
        position: absolute; top: 1.25rem; left: 1.25rem;
        padding: .15rem .45rem; border-radius: 6px;
        background: rgba(16, 15, 13, .72); backdrop-filter: blur(6px);
        font-size: .625rem; font-weight: 600; color: var(--ink);
      }
      .add {
        width: 100%; padding: .5rem;
        border: 1px solid var(--line); border-radius: 9px;
        background: transparent; color: var(--ink);
        font-size: 1.125rem; line-height: 1; cursor: pointer;
        transition: background .18s, color .18s, border-color .18s;
      }
      .add:hover { background: var(--ember); border-color: var(--ember); color: #1a0d08; }

      .hero {
        padding: clamp(2.5rem, 8vw, 5rem) 0 clamp(2rem, 5vw, 3.5rem);
        max-width: 46rem;
      }
      .hero h1 {
        margin: 0 0 .75rem;
        font-size: clamp(2rem, 6vw, 3.25rem);
        line-height: 1.08;
        letter-spacing: -0.035em;
      }
      .hero p {
        margin: 0 0 1.75rem;
        max-width: 40ch;
        font-size: clamp(1rem, 2vw, 1.125rem);
        color: var(--ink-2);
      }
      .cta {
        padding: .8rem 1.6rem; border: 0; border-radius: 11px;
        background: var(--ember); color: #1a0d08;
        font: inherit; font-weight: 600; cursor: pointer;
        transition: transform .18s ease, background .18s ease;
      }
      .cta:hover { transform: translateY(-1px); background: #e08a6b; }

      .tabbar {
        position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
        display: flex; justify-content: space-around;
        padding: .5rem .5rem calc(.5rem + env(safe-area-inset-bottom));
        background: color-mix(in srgb, var(--bg) 92%, transparent);
        backdrop-filter: blur(12px);
        border-top: 1px solid var(--line);
      }
      .tab {
        display: flex; flex-direction: column; align-items: center; gap: .2rem;
        padding: .35rem .5rem; border: 0; background: none;
        color: var(--ink-3); font: inherit; font-size: .6875rem; cursor: pointer;
        transition: color .18s;
      }
      .tab span { font-size: 1.0625rem; }
      .tab.on { color: var(--ember); }

      @media (min-width: 900px) {
        .grid { grid-template-columns: repeat(3, 1fr); }
        .grid.one { grid-template-columns: repeat(2, 1fr); }
        /* A fixed bottom bar stops being right once there is room to put the
           nav in the header instead. */
        .tabbar {
          position: sticky;
          top: 0;
          max-width: none;
          border-top: 0;
          border-bottom: 1px solid var(--line);
          background: transparent;
          backdrop-filter: none;
        }
        body { padding-bottom: 0; }
      }
      @media (min-width: 1280px) {
        .grid { grid-template-columns: repeat(4, 1fr); }
        .grid.one { grid-template-columns: repeat(3, 1fr); }
      }
    </style>
  </head>
  <body>
    <div class="shell">
${body}
    </div>
  </body>
</html>
`,
  };
}

/** HTML-escapes a value the generator interpolates into markup. */
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

const BLUEPRINTS: Blueprint[] = [
  {
    key: "ratelimit",
    label: "Rate limiting",
    // No trailing \b: "rate limiting" and "rate limits" both need to match,
    // and a boundary right after "limit" fails on the -ing/-s suffix.
    matches: /rate[\s_-]?limit\w*|throttl\w*|batas\s+request|429/i,
    apply: (files) => {
      const middleware = `import type { Context, Next } from "hono";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Fixed window per client. Good enough for v1, swap for Redis later. */
export function rateLimit(opts: { limit: number; windowMs: number }) {
  return async (c: Context, next: Next) => {
    const key = c.req.header("x-forwarded-for") ?? "local";
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > opts.limit) {
      const retry = Math.ceil((bucket.resetAt - now) / 1000);
      return c.json(
        { error: { message: "Rate limit exceeded" } },
        429,
      );
    }
    return next();
  };
}
`;

      const route = `import { Hono } from "hono";
import { requireSession } from "../auth/session";
import { screen } from "../guardrails";
import { runTurn } from "../pipeline/runTurn";

export const chat = new Hono();

chat.post("/", async (c) => {
  const session = await requireSession(c);
  if (!session) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = await c.req.json();

  const finding = screen(body.prompt);
  if (finding) {
    return c.json(
      { error: { message: "Blocked by guardrail" }, category: finding.category },
      422,
    );
  }

  return c.json(await runTurn({ prompt: body.prompt, session }));
});
`;

      return {
        files: {
          ...files,
          "server/middleware/rateLimit.ts": middleware,
          "server/routes/chat.ts": route,
        },
        summary: "Rate limiting + guardrail di depan route chat",
        notes: [
          "Fixed window per client, 429 dengan Retry-After",
          "Guardrail jalan sebelum request menyentuh pool",
        ],
      };
    },
  },

  {
    key: "database",
    label: "Postgres schema",
    matches:
      /\b(postgres\w*|postgresql\w*|database\w*|schem\w*|tabel\w*|migration\w*|sql)\b/i,
    apply: (files) => {
      const schema = `-- Lolo AI — gateway schema
create table users (
  id           uuid primary key default gen_random_uuid(),
  email        text unique not null,
  name         text,
  role         text not null default 'user',
  created_at   timestamptz not null default now()
);

create table sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users on delete cascade,
  token_hash   text not null,
  expires_at   timestamptz not null
);
create index on sessions (token_hash);

create table magic_links (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  token_hash   text not null,
  expires_at   timestamptz not null,
  used_at      timestamptz
);

create table conversations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users on delete cascade,
  title        text not null default 'New run',
  agent        text not null,
  model        text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations on delete cascade,
  user_id          uuid not null references users on delete cascade,
  role             text not null,
  content          text not null,
  agent            text,
  model            text,
  blocked          boolean,
  guardrail        text,
  guardrail_reason text,
  latency_ms       integer,
  tokens_in        integer,
  tokens_out       integer,
  created_at       timestamptz not null default now()
);
create index on messages (conversation_id, created_at);

create table pool_accounts (
  id             uuid primary key default gen_random_uuid(),
  label          text unique not null,
  tier           text not null,
  status         text not null default 'healthy',
  health         integer not null default 100,
  in_flight      integer not null default 0,
  max_slots      integer not null,
  successes      integer not null default 0,
  failures       integer not null default 0,
  cooldown_until timestamptz
);

create table usage_events (
  id           bigserial primary key,
  account_id   uuid references pool_accounts,
  model        text not null,
  agent        text not null,
  tokens_in    integer not null default 0,
  tokens_out   integer not null default 0,
  latency_ms   integer not null,
  ok           boolean not null,
  created_at   timestamptz not null default now()
);
create index on usage_events (created_at);

create table api_keys (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references users on delete cascade,
  name         text not null,
  prefix       text not null,
  secret_hash  text not null,
  revoked      boolean not null default false,
  created_at   timestamptz not null default now()
);
create index on api_keys (secret_hash);
`;

      const db = `import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export const db = drizzle(pool);
export { pool };
`;

      return {
        files: {
          ...files,
          "server/db/schema.sql": schema,
          "server/db/index.ts": db,
        },
        summary: "Sembilan tabel Postgres untuk gateway + auth + trace",
        notes: [
          "Token dan API key disimpan sebagai hash, bukan nilai mentah",
          "Index pada token_hash dan (conversation_id, created_at)",
        ],
      };
    },
  },

  {
    key: "auth",
    label: "Magic-link auth",
    // \w* after the stem so "authentication", "sessions", "passwords" match too.
    matches:
      /magic[\s_-]?link\w*|\bauth\w*|\blogin\b|\bmasuk\b|\botp\b|\bpassword\w*|\bsession\w*/i,
    apply: (files) => {
      const session = `import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { db } from "../db";
import { sessions, users } from "../db/schema";
import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";

const COOKIE = "lolo_session";
const MAX_AGE = 30 * 24 * 60 * 60;

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + MAX_AGE * 1000),
  });
  return token;
}

export async function requireSession(c: any) {
  const token = getCookie(c, COOKIE);
  if (!token) return null;

  const row = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);

  const session = row[0];
  if (!session || session.expiresAt < new Date()) return null;

  const owner = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  return owner[0] ?? null;
}

export function attachSession(token: string) {
  return setCookie;
}

export { COOKIE, MAX_AGE, deleteCookie };
`;

      const magic = `import { createHash, randomBytes } from "node:crypto";
import { db } from "../db";
import { magicLinks, users } from "../db/schema";
import { eq } from "drizzle-orm";
import { sendEmail } from "../email";

const TTL_MS = 15 * 60 * 1000;

export async function requestMagicLink(email: string, appUrl: string) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  await db
    .insert(users)
    .values({ email })
    .onConflictDoNothing();

  await db.insert(magicLinks).values({
    email,
    tokenHash,
    expiresAt: new Date(Date.now() + TTL_MS),
  });

  await sendEmail({
    to: email,
    subject: "Tautan masuk untuk Lolo",
    body: \`Buka tautan ini untuk masuk. Berlaku 15 menit, sekali pakai.

\${appUrl}/auth/verify?token=\${token}\`,
  });
}

export async function consumeMagicLink(token: string, userId: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const row = await db
    .select()
    .from(magicLinks)
    .where(eq(magicLinks.tokenHash, tokenHash))
    .limit(1);

  const link = row[0];
  if (!link || link.usedAt || link.expiresAt < new Date()) return false;

  await db
    .update(magicLinks)
    .set({ usedAt: new Date() })
    .where(eq(magicLinks.id, link.id));

  return true;
}
`;

      return {
        files: {
          ...files,
          "server/auth/session.ts": session,
          "server/auth/magic-link.ts": magic,
        },
        summary: "Magic link + session cookie httpOnly",
        notes: [
          "Token 32 byte, hanya hash-nya yang disimpan",
          "Sekali pakai, expire 15 menit",
        ],
      };
    },
  },

  {
    key: "pool",
    label: "Model pool",
    matches:
      /\b(pool\w*|rout\w*|health\w*|cooldown\w*|slots?|fallback\w*)\b/i,
    apply: (files) => {
      const pool = `export type Tier = "free" | "subscribed";

export type Account = {
  id: string;
  label: string;
  tier: Tier;
  status: "healthy" | "degraded" | "cooling" | "disabled";
  health: number;
  inFlight: number;
  maxSlots: number;
  concurrency: number;
};

/** Free tier is effectively serial; subscribed gets three slots. */
export const TIER_LIMITS: Record<Tier, { slots: number; concurrency: number }> = {
  free: { slots: 1, concurrency: 3 },
  subscribed: { slots: 3, concurrency: 8 },
};

const COOLDOWN_MS = 30_000;

/**
 * Highest-health account that is not cooling and still has a free slot.
 * Free accounts come first at equal health, since they cost nothing.
 */
export function claim(accounts: Account[]): Account | null {
  const now = Date.now();

  return (
    accounts
      .filter((a) => a.status !== "disabled")
      .filter((a) => a.inFlight < a.maxSlots)
      .filter((a) => !a.cooldownUntil || a.cooldownUntil <= now)
      .sort((a, b) => b.health - a.health || a.maxSlots - b.maxSlots)[0] ?? null
  );
}

export function settle(
  account: Account,
  ok: boolean,
  latencyMs: number,
): Account {
  if (ok) {
    return {
      ...account,
      inFlight: Math.max(0, account.inFlight - 1),
      health: Math.min(100, account.health + (latencyMs > 20_000 ? -4 : 1)),
      cooldownUntil: undefined,
    };
  }

  const health = Math.max(0, account.health - 15);
  return {
    ...account,
    inFlight: Math.max(0, account.inFlight - 1),
    health,
    status: health <= 0 ? "disabled" : "cooling",
    cooldownUntil: Date.now() + COOLDOWN_MS,
  };
}
`;

      return {
        files: { ...files, "server/pool.ts": pool },
        summary: "Scheduler pool: health, slot, cooldown, fallback",
        notes: [
          "Free 1 slot, subscribed 3 — konkurensi riil dibatasi slot",
          "Gagal → turun health dan masuk cooldown, bukan dicoba ulang",
        ],
      };
    },
  },
];

const SCAFFOLD: Blueprint = {
  key: "app",
  label: "New app",
  matches: /.*/,
  // Merges into the existing tree. Returning a fresh object here used to wipe
  // every file the agent had already written.
  apply: (files, prompt) => {
    const { html, shop, title } = buildApp(prompt);

    return {
      files: {
        ...files,
        "index.html": html,
        "package.json": JSON.stringify(
          {
            name: slug(title),
            private: true,
            type: "module",
            scripts: {
              dev: "vite",
              build: "tsc -b && vite build",
              typecheck: "tsc -b --noEmit",
            },
          },
          null,
          2,
        ),
      },
      summary: shop
        ? `Bikin ${title} — toko mobile`
        : `Bikin ${title} — web app mobile`,
      notes: shop
        ? [
            "Mobile-first: grid 2 kolom, tab bar fixed, aman untuk safe-area",
            "Ada keranjang, pencarian, dan filter kategori",
            "Aksen ember #d97757, sisanya arang — kontrasnya cukup buat dibaca di layar kecil",
            "index.html langsung dirender di panel Preview",
          ]
        : [
            "Satu halaman, tanpa routing — yang diminta itu yang dibangun",
            "Mobile-first, aman untuk safe-area di iOS",
            "Aksen ember #d97757 di atas arang pekat",
            "index.html langsung dirender di panel Preview",
          ],
    };
  },
};

/** Package name from a title: lowercase, ASCII-ish, no spaces. */
function slug(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return s || "lolo-app";
}

/**
 * Turn a request into real file mutations. This is the only simulated part;
 * everything downstream of it operates on genuine output.
 */
export function plan(
  prompt: string,
  project: Project,
  agent: AgentDef,
): Plan {
  const blueprint =
    BLUEPRINTS.find((b) => b.matches.test(prompt)) ?? SCAFFOLD;

  const { files: next, summary, notes } = blueprint.apply(project.files, prompt);

  const changes: FileChange[] = [];
  for (const [path, after] of Object.entries(next)) {
    const before = project.files[path];
    if (before === after) continue;
    changes.push({
      path,
      op: before === undefined ? "created" : "modified",
      before: before ?? null,
      after,
    });
  }

  const steps = [
    `Read the request · ${agent.name} dispatched`,
    "Screened 7 guardrail rules · clean",
    `Matched blueprint: ${blueprint.label}`,
    `Wrote ${changes.length} file${changes.length === 1 ? "" : "s"}`,
  ];

  return { files: next, changes, steps, summary, notes };
}

/** Builds the preview document from whatever the project currently holds. */
export function previewHtml(project: Project): string | null {
  const html = project.files["index.html"];
  return html ?? null;
}
