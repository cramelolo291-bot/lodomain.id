// The single seam between the UI and the backend.
//
// `mockApi` stands in for the Hono + PostgreSQL server while the UI is built.
// It returns the same JSON shapes the real server will, so switching to
// `httpApi` is a one-line change at the bottom of this file.

import {
  AGENTS,
  ALTERNATIVES,
  DAILY_FREEBUCKS,
  GATEWAY_ROUTES,
  MODELS,
  TIER_LIMITS,
  getAgent,
  getModel,
  preferredAgent,
  type Effort,
  type Tier,
} from "./catalog";
import {
  GUARDRAIL_LABELS,
  screen,
  type GuardrailCategory,
  type Severity,
} from "./guardrails";
import {
  plan,
  runCommand,
  type FileChange,
  type Project,
} from "./project";
import {
  addRow as dataAddRow,
  applySql,
  createTable as dataCreateTable,
  deleteRow as dataDeleteRow,
  dropTable as dataDropTable,
  seedData,
  tablesFor,
  tablesForPrompt,
  mergeTables,
  updateRow as dataUpdateRow,
  type Column,
  type DataSpace,
  type QueryResult,
  type Row,
  type Table,
} from "./data";

// ── Shapes (identical to the future server's JSON) ─────────────────────────

export type Role = "admin" | "user";

export type Session = {
  email: string;
  name: string;
  role: Role;
};

export type Conversation = {
  id: string;
  title: string;
  agent: string;
  model: string;
  updatedAt: number;
};

export type Message = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  agent?: string;
  model?: string;
  blocked?: boolean;
  guardrail?: GuardrailCategory;
  guardrailReason?: string;
  latencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  createdAt: number;
};

export type AccountStatus = "healthy" | "degraded" | "cooling" | "disabled";

/** One upstream account in the gateway pool, routed by health and capacity. */
export type PoolAccount = {
  id: string;
  label: string;
  tier: Tier;
  status: AccountStatus;
  health: number;
  inFlight: number;
  /** Serial slots. Effective concurrency is capped by this number. */
  maxSlots: number;
  /** Concurrent requests allowed inside a slot. */
  concurrency: number;
  successes: number;
  failures: number;
  cooldownUntil?: number;
  lastUsedAt?: number;
};

export type PoolSummary = {
  total: number;
  healthy: number;
  freeSlots: number;
  totalSlots: number;
  avgHealth: number;
};

export type TraceStep = {
  id: string;
  at: number;
  label: string;
  detail: string;
  ms: number;
  status: "ok" | "blocked" | "failed" | "skipped";
};

export type Trace = {
  id: string;
  conversationId: string;
  prompt: string;
  agent: string;
  model: string;
  account: string;
  ok: boolean;
  totalMs: number;
  tokensIn: number;
  tokensOut: number;
  steps: TraceStep[];
};

export type UsageStats = {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  failed: number;
  avgLatencyMs: number;
  perModel: Array<{ model: string; count: number }>;
  perAccount: Array<{ label: string; ok: number; failed: number }>;
};

export type Finding = {
  id: string;
  category: GuardrailCategory;
  severity: Severity;
  reason: string;
  at: number;
};

export type FindingsResult = {
  total: number;
  recent: Finding[];
  byCategory: Array<{ category: string; count: number }>;
};

export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt?: number;
  revoked: boolean;
};

/** Gateway configuration and health, mirroring the upstream config surface. */
export type GatewayInfo = {
  upstream: string;
  listenAddr: string;
  status: "ok" | "degraded";
  keepaliveMs: number;
  memoryEnabled: boolean;
  credits: number;
};

export type RouteDef = { method: string; path: string; note: string };

export type TurnResult =
  | {
      status: "ok";
      traceId: string;
      changes: FileChange[];
      summary: string;
      /** Present when the agent asked for a build in its own answer. */
      build?: {
        ok: boolean;
        code: number | null;
        ms: number;
        output: string;
        skipped?: string;
      };
    }
  | { status: "blocked"; guardrail: GuardrailCategory }
  | { status: "error"; reason: string };

export type CommandResult = { out: string[]; code: number };

/** Events a streaming turn emits. Mirrors server/pipeline/run-turn.ts. */
export type TurnEvent =
  | { type: "step"; step: { stage: string; detail: string; ms: number; status: "ok" | "warn" | "error" } }
  | { type: "delta"; text: string }
  | { type: "file"; path: string; op: "created" | "modified" }
  | { type: "table"; name: string; rows: number }
  | { type: "build"; line: string }
  | { type: "buildDone"; ok: boolean; code: number | null; ms: number; skipped?: string }
  | { type: "done"; result: TurnResult };

// ── Mock backend ──────────────────────────────────────────────────────────

const STORAGE_KEY = "lolo.mock.v1";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

type MockState = {
  session: Session | null;
  conversations: Conversation[];
  messages: Message[];
  pool: PoolAccount[];
  traces: Trace[];
  findings: Finding[];
  keys: ApiKey[];
  project: Project;
  /** Per-project data space. Every project gets its own tables. */
  data: DataSpace;
};

function seed(): MockState {
  const now = Date.now();
  const yesterday = now - DAY;

  const account = (
    id: string,
    label: string,
    tier: Tier,
    health: number,
    successes: number,
    failures: number,
    extra: Partial<PoolAccount> = {},
  ): PoolAccount => ({
    id,
    label,
    tier,
    status: "healthy",
    health,
    inFlight: 0,
    maxSlots: TIER_LIMITS[tier].slots,
    concurrency: TIER_LIMITS[tier].concurrency,
    successes,
    failures,
    ...extra,
  });

  return {
    session: null,
    conversations: [
      {
        id: "c1",
        title: "Migrasi schema Postgres untuk agent gateway",
        agent: "forge",
        model: "deepseek/deepseek-v4.1-flash",
        updatedAt: now - 12 * MIN,
      },
      {
        id: "c2",
        title: "Bandingkan effort support antar model",
        agent: "lolo",
        model: "z-ai/glm-5.3-flash",
        updatedAt: yesterday,
      },
      {
        id: "c3",
        title: "Audit guardrail rules",
        agent: "redteam",
        model: "meta/muse-spark-1.2",
        updatedAt: yesterday - 3 * HOUR,
      },
    ],
    messages: [
      {
        id: "m1",
        conversationId: "c1",
        role: "user",
        content:
          "Bikin skema Postgres buat gateway AI multi-user. Tiap user butuh API key sendiri.",
        agent: "forge",
        createdAt: now - 14 * MIN,
      },
      {
        id: "m2",
        conversationId: "c1",
        role: "assistant",
        content:
          "Sembilan tabel. Ringkasnya:\n\n- `users` — akun dan role admin/user\n- `sessions` — simpan token hash, bukan token mentah\n- `magic_links` — hash plus `used_at`, sekali pakai\n- `conversations` dan `messages` — chat, dengan `messages` menunjuk `conversation_id`\n- `pool_accounts` — health, in_flight, cooldown_until per akun upstream\n- `usage_events` — metrik per request\n- `api_keys` — `secret_hash`; nilai mentah hanya tampil sekali saat pembuatan\n\n- `traces` dan `trace_steps` — jejak tiap giliran, supaya \"kenapa jawabannya gitu\" bisa ditelusuri\n\nYang paling sering kelupaan: `api_keys.secret` WAJIB di-hash. Kalau disimpan mentah, sekali bocor semua key ikut mati.",
        agent: "forge",
        model: "deepseek/deepseek-v4.1-flash",
        latencyMs: 4310,
        tokensIn: 812,
        tokensOut: 247,
        createdAt: now - 12 * MIN,
      },
    ],
    pool: [
      account("a1", "free-primary", "free", 92, 184, 3),
      account("a2", "free-secondary", "free", 74, 61, 9),
      account("a3", "subscribed-1", "subscribed", 97, 402, 2, {
        inFlight: 1,
        lastUsedAt: now - 2 * MIN,
      }),
      account("a4", "subscribed-2", "subscribed", 88, 233, 6, {
        lastUsedAt: now - 19 * MIN,
      }),
      account("a5", "free-legacy", "free", 41, 18, 22, {
        status: "degraded",
        lastUsedAt: yesterday - 5 * HOUR,
      }),
    ],
    traces: [
      {
        id: "t1",
        conversationId: "c1",
        prompt: "Bikin skema Postgres buat gateway AI multi-user…",
        agent: "forge",
        model: "deepseek/deepseek-v4.1-flash",
        account: "subscribed-1",
        ok: true,
        totalMs: 4310,
        tokensIn: 812,
        tokensOut: 247,
        steps: [
          { id: "s1", at: now - 14 * MIN, label: "guardrail", detail: "clean · 7 rules", ms: 1, status: "ok" },
          { id: "s2", at: now - 14 * MIN, label: "effort", detail: "high · supported", ms: 1, status: "ok" },
          { id: "s3", at: now - 14 * MIN, label: "pool", detail: "claimed subscribed-1", ms: 3, status: "ok" },
          { id: "s4", at: now - 13 * MIN, label: "upstream", detail: "247 tokens · keepalive 45s", ms: 4305, status: "ok" },
        ],
      },
    ],
    findings: [
      {
        id: "f1",
        category: "credential_access",
        severity: "critical",
        reason: "Asks for secrets, tokens or private keys.",
        at: now - 2 * HOUR,
      },
      {
        id: "f2",
        category: "prompt_injection",
        severity: "high",
        reason: "Tries to override the operator's instructions mid-conversation.",
        at: now - 5 * HOUR,
      },
      {
        id: "f3",
        category: "jailbreak",
        severity: "medium",
        reason: "Roleplay framing used to shed the model's restrictions.",
        at: yesterday - 2 * HOUR,
      },
      {
        id: "f4",
        category: "pii_leakage",
        severity: "high",
        reason: "Message carries personal data that should not be stored or echoed.",
        at: yesterday - 6 * HOUR,
      },
    ],
    keys: [
      {
        id: "k1",
        name: "Laptop rafi",
        prefix: "sk-lolo-8f2a…",
        createdAt: yesterday,
        lastUsedAt: now - 2 * HOUR,
        revoked: false,
      },
      {
        id: "k2",
        name: "Cursor (test)",
        prefix: "sk-lolo-1c93…",
        createdAt: yesterday - DAY,
        revoked: true,
      },
    ],
    project: {
      name: "lolo-app",
      files: {
        "package.json": `{
  "name": "lolo-app",
  "private": true,
  "type": "module"
}`,
        "server/index.ts": `import { Hono } from "hono";

const app = new Hono();

app.get("/healthz", (c) => c.json({ status: "ok" }));

export default app;`,
      },
    },
    data: seedData(),
  };
}

/**
 * Reads persisted state, filling in anything the stored copy is missing.
 *
 * A plain `JSON.parse(raw) as MockState` is a lie: the moment a field is added
 * to MockState — `data` was — every browser holding an older snapshot returns
 * an object without it, and the first access throws on `undefined`. Merging
 * over a fresh seed means old snapshots get the new defaults and keep their
 * existing data, instead of crashing the app on open.
 */
function load(): MockState {
  const base = seed();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<MockState>;
    return { ...base, ...saved };
  } catch {
    // Corrupt or unavailable storage falls through to a fresh seed.
    return base;
  }
}

function save(state: MockState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be blocked in the preview; the app still works in-session.
  }
}

const state = load();
const listeners = new Set<() => void>();

function commit() {
  save(state);
  listeners.forEach((fn) => fn());
}

function uid(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const GATEWAY: GatewayInfo = {
  upstream: "https://www.codebuff.com",
  listenAddr: "127.0.0.1:47821",
  status: "ok",
  keepaliveMs: 45_000,
  memoryEnabled: false,
  credits: 1240,
};

/** Canned replies, so the preview shows a real conversation shape. */
/** Closing commentary, per specialist. Kept short: the diff is the answer. */
const CLOSING: Record<string, string> = {
  lolo: "Semua perubahan ada di tab **Changes**. Kalau ada yang belum sesuai, sebut file-nya dan gue ubah bagian itu saja.",
  scout: "Gw petakan dulu sebelum ngubah: server/db dipakai buat koneksi, server/routes buat handler. Kalau nanti nambah endpoint baru, polanya sama.",
  forge: "Perubahan paling kecil yang bener. Kalau ada requirement yang belum gue tangani, sebut — jangan nebak.",
  redteam: "Yang gue cokot di diff ini: path `chat.ts` masih menerima body tanpa validasi. Kalau lo expose endpoint ini, itu celah pertama yang orang tembak.",
};

/** Builds the reply from the real plan, not a canned blob. */
function renderReply(
  result: ReturnType<typeof plan>,
  prompt: string,
  agentKey: string,
): string {
  const { changes, summary, notes } = result;

  if (changes.length === 0) {
    return [
      `Gw udah baca permintaannya — "${prompt.slice(0, 70)}…" — tapi hasil yang dibangun identik sama dengan yang sudah ada di project, jadi nggak ada diff buat ditampilkan.`,
      "",
      "Isi project sekarang:",
      "",
      ...Object.keys(result.files).map((p) => `- \`${p}\``),
      "",
      "Kalau mau hasil yang beda, sebut lebih spesifik — nama, warna, halaman, atau fitur tertentu. Kalau emang mau nambah sesuatu ke kode yang sudah ada, sebut tekniknya: rate limit, schema database, magic-link auth, atau model pool.",
    ].join("\n");
  }

  const created = changes.filter((c) => c.op === "created");
  const modified = changes.filter((c) => c.op === "modified");

  return [
    `${summary}.`,
    "",
    created.length > 0
      ? `**Dibuat** (${created.length})\n${created.map((c) => `- \`${c.path}\``).join("\n")}`
      : "",
    modified.length > 0
      ? `**Diubah** (${modified.length})\n${modified.map((c) => `- \`${c.path}\``).join("\n")}`
      : "",
    "",
    ...notes.map((n) => `- ${n}`),
    "",
    CLOSING[agentKey] ?? "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** Highest effort the chosen model actually accepts. */
function effortFor(id: string, wanted: Effort | undefined): Effort | undefined {
  const model = getModel(id);
  if (model.efforts.length === 0) return undefined;
  if (wanted && model.efforts.includes(wanted)) return wanted;
  return model.efforts.includes("high") ? "high" : model.efforts[0];
}

function mockApi() {
  return {
    async gateway(): Promise<GatewayInfo> {
      return GATEWAY;
    },

    async routes(): Promise<RouteDef[]> {
      return GATEWAY_ROUTES.map((r) => ({ ...r }));
    },

    async requestMagicLink(email: string): Promise<void> {
      await wait(500);
      const name = email.split("@")[0]!.replace(/[._-]/g, " ");
      state.session = {
        email,
        name: name.replace(/\b\w/g, (c) => c.toUpperCase()),
        role: "admin",
      };
      commit();
    },

    async session(): Promise<Session | null> {
      return state.session;
    },

    async signOut(): Promise<void> {
      state.session = null;
      commit();
    },

    async listConversations(): Promise<Conversation[]> {
      return [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async createConversation(agent?: string, model?: string): Promise<Conversation> {
      const c: Conversation = {
        id: uid("c"),
        title: "New run",
        agent: agent ?? "lolo",
        model: model ?? MODELS[0]!.id,
        updatedAt: Date.now(),
      };
      state.conversations.unshift(c);
      commit();
      return c;
    },

    async updateConversation(
      id: string,
      patch: { agent?: string; model?: string },
    ): Promise<void> {
      const c = state.conversations.find((x) => x.id === id);
      if (c) {
        Object.assign(c, patch, { updatedAt: Date.now() });
        commit();
      }
    },

    async deleteConversation(id: string): Promise<void> {
      state.conversations = state.conversations.filter((c) => c.id !== id);
      state.messages = state.messages.filter((m) => m.conversationId !== id);
      commit();
    },

    async listMessages(conversationId: string): Promise<Message[]> {
      return state.messages
        .filter((m) => m.conversationId === conversationId)
        .sort((a, b) => a.createdAt - b.createdAt);
    },

    async getProject(): Promise<Project> {
      return state.project;
    },

    async runCommand(cmd: string): Promise<CommandResult> {
      return runCommand(cmd, state.project);
    },

    /** A mock response must never claim that a real build ran. */
    async runBuild(_project: string, target: BuildTarget): Promise<BuildResult> {
      const reason = "Not executed in mock mode. Switch to the real HTTP backend to run a real build.";
      return {
        ok: false,
        target,
        code: null,
        output: reason,
        ms: 0,
        timedOut: false,
        command: "",
        skipped: reason,
        hasOutput: false,
      };
    },

    previewUrl: (_project: string) => "",

    /**
     * The mock cannot really run a dev server, so this reports the one thing
     * the UI acts on — that it is not available — rather than pretending.
     */
    async startDev(_project: string): Promise<DevResult> {
      return {
        ok: false,
        reason:
          'The preview is mocked. Add a "dev" script to package.json and run with VITE_API_MODE=http to get a live server.',
      };
    },
    stopDev: async (_project: string) => ({ ok: true }),
    devUrl: (_project: string) => "",

    async resetProject(): Promise<void> {
      state.project = seed().project;
      commit();
    },

    // ── Per-project data space ──────────────────────────────────────────
    // No caps anywhere: tables, columns, rows, cells. The only ceiling is
    // what the browser will hold.

    async dataTables(project: string): Promise<Table[]> {
      return tablesFor(state.data, project).map((t) => ({
        ...t,
        columns: t.columns.map((c) => ({ ...c })),
        rows: t.rows.map((r) => ({ ...r })),
      }));
    },

    async dataAddRow(project: string, table: string, values: Row): Promise<Row> {
      const current = tablesFor(state.data, project);
      const { tables, row } = dataAddRow(current, table, values);
      state.data = { ...state.data, [project]: tables };
      commit();
      return row;
    },

    async dataUpdateRow(
      project: string,
      table: string,
      pk: string,
      key: string,
      column: string,
      value: string,
    ): Promise<void> {
      state.data = {
        ...state.data,
        [project]: dataUpdateRow(
          tablesFor(state.data, project),
          table,
          pk,
          key,
          column,
          value,
        ),
      };
      commit();
    },

    async dataDeleteRow(
      project: string,
      table: string,
      pk: string,
      key: string,
    ): Promise<void> {
      state.data = {
        ...state.data,
        [project]: dataDeleteRow(tablesFor(state.data, project), table, pk, key),
      };
      commit();
    },

    async dataCreateTable(
      project: string,
      name: string,
      columns: Column[],
    ): Promise<void> {
      state.data = {
        ...state.data,
        [project]: dataCreateTable(tablesFor(state.data, project), name, columns),
      };
      commit();
    },

    async dataDropTable(project: string, name: string): Promise<void> {
      state.data = {
        ...state.data,
        [project]: dataDropTable(tablesFor(state.data, project), name),
      };
      commit();
    },

    async dataQuery(project: string, sql: string): Promise<QueryResult> {
      const current = tablesFor(state.data, project);
      const { tables, result } = applySql(current, sql);
      state.data = { ...state.data, [project]: tables };
      commit();
      return result;
    },

    async pool(): Promise<{ accounts: PoolAccount[]; summary: PoolSummary }> {
      const now = Date.now();
      const accounts = state.pool.map((a) => ({
        ...a,
        status:
          a.cooldownUntil !== undefined && a.cooldownUntil > now
            ? ("cooling" as AccountStatus)
            : a.status,
      }));
      const healthy = accounts.filter((a) => a.status === "healthy");
      return {
        accounts,
        summary: {
          total: accounts.length,
          healthy: healthy.length,
          freeSlots: healthy.reduce(
            (sum, a) => sum + Math.max(0, a.maxSlots - a.inFlight),
            0,
          ),
          totalSlots: accounts.reduce((s, a) => s + a.maxSlots, 0),
          avgHealth: accounts.length
            ? Math.round(
                accounts.reduce((s, a) => s + a.health, 0) / accounts.length,
              )
            : 0,
        },
      };
    },

    async setAccountStatus(
      id: string,
      status: "healthy" | "disabled",
    ): Promise<void> {
      const a = state.pool.find((x) => x.id === id);
      if (!a) return;
      a.status = status;
      if (status === "healthy") {
        a.health = 100;
        a.cooldownUntil = undefined;
      }
      if (status === "disabled") a.inFlight = 0;
      commit();
    },

    async addAccount(label: string, tier: Tier): Promise<void> {
      if (state.pool.some((a) => a.label === label)) return;
      state.pool.push({
        id: uid("a"),
        label,
        tier,
        status: "healthy",
        health: 100,
        inFlight: 0,
        maxSlots: TIER_LIMITS[tier].slots,
        concurrency: TIER_LIMITS[tier].concurrency,
        successes: 0,
        failures: 0,
      });
      commit();
    },

    async removeAccount(id: string): Promise<void> {
      state.pool = state.pool.filter((a) => a.id !== id);
      commit();
    },

    async traces(): Promise<Trace[]> {
      return [...state.traces].sort((a, b) => b.steps[0]!.at - a.steps[0]!.at);
    },

    async usage(): Promise<UsageStats> {
      const total = state.pool.reduce((s, a) => s + a.successes + a.failures, 0);
      const failed = state.pool.reduce((s, a) => s + a.failures, 0);
      return {
        requests: total,
        tokensIn: total * 412,
        tokensOut: total * 138,
        failed,
        avgLatencyMs: 3890,
        perModel: [
          { model: "z-ai/glm-5.3-flash", count: 142 },
          { model: "deepseek/deepseek-v4.1-flash", count: 118 },
          { model: "meta/muse-spark-1.2", count: 76 },
          { model: "solar/solar-pro4", count: 41 },
          { model: "stealth/ox-alpha", count: 18 },
        ],
        perAccount: state.pool.map((a) => ({
          label: a.label,
          ok: a.successes,
          failed: a.failures,
        })),
      };
    },

    async findings(): Promise<FindingsResult> {
      const byCategory = new Map<string, number>();
      for (const f of state.findings) {
        byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
      }
      return {
        total: state.findings.length,
        recent: [...state.findings].sort((a, b) => b.at - a.at),
        byCategory: [...byCategory.entries()]
          .map(([category, count]) => ({ category, count }))
          .sort((a, b) => b.count - a.count),
      };
    },

    async listKeys(): Promise<ApiKey[]> {
      return [...state.keys].sort((a, b) => b.createdAt - a.createdAt);
    },

    async createKey(name: string): Promise<{ id: string; secret: string }> {
      const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
      const secret = `sk-lolo-${Array.from(
        { length: 24 },
        () => alphabet[Math.floor(Math.random() * alphabet.length)],
      ).join("")}`;
      const key: ApiKey = {
        id: uid("k"),
        name,
        prefix: `${secret.slice(0, 12)}…`,
        createdAt: Date.now(),
        revoked: false,
      };
      state.keys.unshift(key);
      commit();
      return { id: key.id, secret };
    },

    async revokeKey(id: string): Promise<void> {
      const k = state.keys.find((x) => x.id === id);
      if (k) {
        k.revoked = true;
        commit();
      }
    },

    /**
     * The turn pipeline, running against the mock: screen, resolve effort,
     * claim an account slot, "generate", settle, record. The same steps the
     * Hono server will run against a real upstream.
     */
    async runTurn(args: {
      conversationId: string;
      prompt: string;
      agent: string;
      model: string;
    }): Promise<TurnResult> {
      const started = Date.now();
      const steps: TraceStep[] = [];
      const push = (
        label: string,
        detail: string,
        ms: number,
        status: TraceStep["status"],
      ) => steps.push({ id: uid("s"), at: started, label, detail, ms, status });

      state.messages.push({
        id: uid("m"),
        conversationId: args.conversationId,
        role: "user",
        content: args.prompt,
        agent: args.agent,
        createdAt: started,
      });
      const conv = state.conversations.find((c) => c.id === args.conversationId);
      if (conv) {
        conv.updatedAt = started;
        if (conv.title === "New run") {
          conv.title =
            args.prompt.length <= 72
              ? args.prompt
              : `${args.prompt.slice(0, 72).trimEnd()}…`;
        }
      }

      // 1 — guardrail
      const finding = screen(args.prompt, "input");
      push(
        "guardrail",
        finding ? `${finding.category} · ${finding.severity}` : "clean · 7 rules",
        1,
        finding ? "blocked" : "ok",
      );

      if (finding) {
        state.findings.unshift({
          id: uid("f"),
          category: finding.category,
          severity: finding.severity,
          reason: finding.reason,
          at: started,
        });
        state.messages.push({
          id: uid("m"),
          conversationId: args.conversationId,
          role: "assistant",
          content:
            "Blocked before dispatch. Giliran ini kena guardrail dan nggak pernah sampai ke model — jadi nggak ada yang terkirim keluar dan nggak ada token yang kepakai.",
          agent: args.agent,
          blocked: true,
          guardrail: finding.category,
          guardrailReason: finding.reason,
          createdAt: Date.now(),
        });
        state.traces.unshift({
          id: uid("t"),
          conversationId: args.conversationId,
          prompt: args.prompt,
          agent: args.agent,
          model: args.model,
          account: "—",
          ok: false,
          totalMs: Date.now() - started,
          tokensIn: 0,
          tokensOut: 0,
          steps,
        });
        commit();
        return { status: "blocked", guardrail: finding.category };
      }

      // 2 — effort resolution: stripped, not rejected
      const model = getModel(args.model);
      const effort = effortFor(args.model, undefined);
      push(
        "effort",
        model.efforts.length === 0
          ? "unsupported · stripped"
          : `${effort} · supported`,
        1,
        "ok",
      );

      // 3 — claim an account slot
      const account = [...state.pool]
        .filter((a) => a.status !== "disabled")
        .sort(
          (a, b) =>
            Number(Boolean(a.cooldownUntil && a.cooldownUntil > Date.now())) -
              Number(Boolean(b.cooldownUntil && b.cooldownUntil > Date.now())) ||
            b.health - a.health,
        )
        .find((a) => a.inFlight < a.maxSlots);

      if (!account) {
        const reason =
          "No free slot in the pool. Every account is busy or cooling down. Add an account from the server panel, or wait for a turn to finish.";
        state.messages.push({
          id: uid("m"),
          conversationId: args.conversationId,
          role: "assistant",
          content: reason,
          agent: args.agent,
          createdAt: Date.now(),
        });
        commit();
        return { status: "error", reason };
      }

      account.inFlight += 1;
      push("pool", `claimed ${account.label}`, 3, "ok");

      // 4 — do the work: mutate the real project tree
      const result = plan(args.prompt, state.project, getAgent(args.agent));
      state.project = { ...state.project, files: result.files };

      // The data space is part of the project too, not a separate thing.
      const name = state.project.name;
      const wanted = tablesForPrompt(args.prompt);
      if (wanted.length) {
        const before = tablesFor(state.data, name);
        const after = mergeTables(before, wanted);
        if (after.length !== before.length) {
          state.data = { ...state.data, [name]: after };
          const added = after.length - before.length;
          push("work", `provisioned ${added} ${added === 1 ? "table" : "tables"}`, 90, "ok");
        }
      }

      for (const s of result.steps.slice(2)) {
        push("work", s, Math.round(60 + Math.random() * 180), "ok");
      }
      const genMs = 1800 + Math.min(4200, args.prompt.length * 9);
      push("upstream", `${args.prompt.length} chars in · keepalive 45s`, genMs, "ok");
      await wait(700);

      // 5 — settle
      account.inFlight = Math.max(0, account.inFlight - 1);
      account.successes += 1;
      account.health = Math.min(100, account.health + 1);
      account.lastUsedAt = Date.now();

      const body = renderReply(result, args.prompt, args.agent);
      const tokensIn = 380 + args.prompt.length;
      const tokensOut = 120 + body.length;

      state.messages.push({
        id: uid("m"),
        conversationId: args.conversationId,
        role: "assistant",
        content: body,
        agent: args.agent,
        model: args.model,
        latencyMs: genMs,
        tokensIn,
        tokensOut,
        createdAt: Date.now(),
      });

      state.traces.unshift({
        id: uid("t"),
        conversationId: args.conversationId,
        prompt: args.prompt,
        agent: args.agent,
        model: args.model,
        account: account.label,
        ok: true,
        totalMs: genMs,
        tokensIn,
        tokensOut,
        steps,
      });
      commit();
      return {
        status: "ok",
        traceId: `t${Date.now()}`,
        changes: result.changes,
        summary: result.summary,
      };
    },
  };
}

export type Api = ReturnType<typeof mockApi>;

/** What a build can do, and what it reports back. Mirrors server/build/runner.ts. */
export type BuildTarget = "install" | "build" | "typecheck" | "test";

export type BuildResult = {
  ok: boolean;
  target: BuildTarget;
  code: number | null;
  output: string;
  ms: number;
  timedOut: boolean;
  command: string;
  skipped?: string;
  hasOutput?: boolean;
};

/** What starting a dev server reports. Mirrors server/build/dev.ts. */
export type DevResult =
  | { ok: true; port: number; reused: boolean; pid: number | null; log: string[]; url: string }
  | { ok: false; reason: string };

// ── Real backend (used once the Hono server exists) ───────────────────────

// `import.meta.env` is a Vite construct. The optional chain keeps this module
// importable outside a bundler (tests, scripts) instead of throwing on load.
const BASE = import.meta.env?.VITE_API_URL ?? "";

function httpApi() {
  const get = <T,>(path: string) =>
    fetch(`${BASE}${path}`, { credentials: "include" }).then(async (r) => {
      if (!r.ok) throw new Error(`${r.status} ${path}`);
      return (await r.json()) as T;
    });
  const send = <T,>(path: string, method: string, body?: unknown) =>
    fetch(`${BASE}${path}`, {
      method,
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => {
      if (!r.ok) throw new Error(`${r.status} ${path}`);
      return (await r.json()) as T;
    });

  return {
    gateway: () => get<GatewayInfo>("/api/gateway"),
    routes: () => get<RouteDef[]>("/api/gateway/routes"),
    requestMagicLink: (email: string) => send<void>("/api/auth/magic-link", "POST", { email }),
    session: () => get<Session | null>("/api/me"),
    signOut: () => send<void>("/api/auth/logout", "POST"),
    listConversations: () => get<Conversation[]>("/api/conversations"),
    createConversation: (agent?: string, model?: string) =>
      send<Conversation>("/api/conversations", "POST", { agent, model }),
    updateConversation: (id: string, patch: { agent?: string; model?: string }) =>
      send<void>(`/api/conversations/${id}`, "PATCH", patch),
    deleteConversation: (id: string) => send<void>(`/api/conversations/${id}`, "DELETE"),
    listMessages: (id: string) => get<Message[]>(`/api/conversations/${id}/messages`),
    getProject: () => get<Project>("/api/project"),
    runCommand: (cmd: string) => send<CommandResult>("/api/terminal", "POST", { cmd }),
    runBuild: (project: string, target: BuildTarget) =>
      send<BuildResult>(`/api/projects/${project}/build`, "POST", { target }),
    previewUrl: (project: string) => `${BASE}/api/projects/${project}/preview`,
    startDev: (project: string) =>
      send<DevResult>(`/api/projects/${project}/dev`, "POST", {}),
    stopDev: (project: string) => send<{ ok: boolean }>(`/api/projects/${project}/dev/stop`, "POST"),
    devUrl: (project: string) => `${BASE}/api/projects/${project}/live/`,
    resetProject: () => send<void>("/api/project", "DELETE"),
    dataTables: (project: string) => get<Table[]>(`/api/projects/${project}/tables`),
    dataAddRow: (project: string, table: string, values: Row) =>
      send<Row>(`/api/projects/${project}/tables/${table}/rows`, "POST", values),
    dataUpdateRow: (
      project: string,
      table: string,
      pk: string,
      key: string,
      column: string,
      value: string,
    ) =>
      send<void>(`/api/projects/${project}/tables/${table}/rows/${key}`, "PATCH", {
        column,
        value,
      }),
    dataDeleteRow: (project: string, table: string, pk: string, key: string) =>
      send<void>(`/api/projects/${project}/tables/${table}/rows/${key}?pk=${pk}`, "DELETE"),
    dataCreateTable: (project: string, name: string, columns: Column[]) =>
      send<void>(`/api/projects/${project}/tables`, "POST", { name, columns }),
    dataDropTable: (project: string, name: string) =>
      send<void>(`/api/projects/${project}/tables/${name}`, "DELETE"),
    dataQuery: (project: string, sql: string) =>
      send<QueryResult>(`/api/projects/${project}/query`, "POST", { sql }),
    pool: () => get<{ accounts: PoolAccount[]; summary: PoolSummary }>("/api/pool"),
    setAccountStatus: (id: string, status: "healthy" | "disabled") =>
      send<void>(`/api/pool/${id}`, "PATCH", { status }),
    addAccount: (label: string, tier: Tier) => send<void>("/api/pool", "POST", { label, tier }),
    removeAccount: (id: string) => send<void>(`/api/pool/${id}`, "DELETE"),
    traces: () => get<Trace[]>("/api/traces"),
    usage: () => get<UsageStats>("/api/usage"),
    findings: () => get<FindingsResult>("/api/guardrails"),
    listKeys: () => get<ApiKey[]>("/api/keys"),
    createKey: (name: string) => send<{ id: string; secret: string }>("/api/keys", "POST", { name }),
    revokeKey: (id: string) => send<void>(`/api/keys/${id}`, "DELETE"),
    runTurn: (args: { conversationId: string; prompt: string; agent: string; model: string }) =>
      send<TurnResult>("/api/turn", "POST", args),
    /**
     * Server-sent events for one turn. Yields the same event shapes the server
     * emits: step, delta, file, table, done.
     */
    runTurnStream: async function* (args: {
      conversationId: string;
      prompt: string;
      agent: string;
      model: string;
    }): AsyncGenerator<TurnEvent> {
      const res = await fetch(`${BASE}/api/turn/stream`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(args),
      });
      if (!res.ok) throw new Error(`${res.status} /api/turn/stream`);
      if (!res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line; a chunk can split one.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            yield JSON.parse(payload) as TurnEvent;
          }
        }
      }
    },
  };
}

/**
 * Production and normal development use the real HTTP backend by default.
 * The mock is only available as an explicit development-only opt-in; a
 * production build can never silently present seeded data as live state.
 */
const apiMode =
  import.meta.env?.VITE_API_MODE ??
  (typeof process !== "undefined" ? process.env.VITE_API_MODE : undefined);
const productionBuild =
  import.meta.env?.PROD === true ||
  (typeof process !== "undefined" && process.env.NODE_ENV === "production");
const useMockApi = apiMode === "mock" && !productionBuild;

export const api: Api = useMockApi ? mockApi() : httpApi();

/** UI warning for the explicitly enabled local-only mock. */
export const isMockMode = useMockApi;

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export {
  AGENTS,
  ALTERNATIVES,
  DAILY_FREEBUCKS,
  GATEWAY_ROUTES,
  MODELS,
  TIER_LIMITS,
  getAgent,
  getModel,
  preferredAgent,
  effortFor,
  GUARDRAIL_LABELS,
};
