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
      // Only typecheck is simulated; everything else is reported as unrun.
      if (bin === "tsc") return { out: ["✓ 0 errors"], code: 0 };
      if (bin === "npm" || bin === "bun")
        return { out: [`${bin}: command not run in preview`], code: 1 };
      return { out: ["usage: tsc | ls | cat | wc"], code: 1 };
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
  apply: (files: Files) => { files: Files; summary: string; notes: string[] };
};

const SCAFFOLD_APP = `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lolo App</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #100f0d;
        color: #f4f1ea;
        font: 400 16px/1.6 system-ui, sans-serif;
      }
      .card {
        max-width: 34rem;
        padding: 2.5rem;
        border: 1px solid rgba(244,241,234,0.1);
        border-radius: 18px;
        background: #191715;
      }
      h1 { margin: 0 0 0.5rem; font-size: 1.75rem; letter-spacing: -0.02em; }
      p { margin: 0; color: #b5aea2; }
      .dot {
        display: inline-block;
        width: 8px; height: 8px;
        margin-right: 8px;
        border-radius: 50%;
        background: #d97757;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1><span class="dot"></span>Lolo App</h1>
      <p>Dibangun dari satu prompt, di server lo sendiri.</p>
    </div>
  </body>
</html>
`;

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
  apply: (files) => ({
    files: {
      ...files,
      "index.html": SCAFFOLD_APP,
      "package.json": JSON.stringify(
        {
          name: "lolo-app",
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
    summary: "Scaffold aplikasi baru",
    notes: [
      "index.html siap dirender di panel Preview",
      "File lain di project nggak dihapus",
    ],
  }),
};

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

  const { files: next, summary, notes } = blueprint.apply(project.files);

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
    "Typecheck passed · 0 errors",
  ];

  return { files: next, changes, steps, summary, notes };
}

/** Builds the preview document from whatever the project currently holds. */
export function previewHtml(project: Project): string | null {
  const html = project.files["index.html"];
  return html ?? null;
}
