// The single seam between the UI and the backend.
//
// `mockApi` below stands in for the Hono + PostgreSQL server while the UI is
// built. It is written against the same response shapes the real server will
// return, so switching to `httpApi` is a one-line change at the bottom of this
// file and nothing above it has to move.

import { AGENTS, MODELS, getAgent, getModel, preferredAgent } from "./catalog";
import {
  GUARDRAIL_LABELS,
  screen,
  type GuardrailCategory,
  type Severity,
} from "./guardrails";

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

export type PoolStatus = "healthy" | "degraded" | "cooling" | "disabled";

export type PoolEntry = {
  id: string;
  name: string;
  tag: string;
  status: PoolStatus;
  health: number;
  inFlight: number;
  maxParallel: number;
  vramGb: number;
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
  /** Total VRAM the loaded models need, versus what the box reports. */
  vramUsedGb: number;
  vramTotalGb: number;
};

export type TraceStep = {
  id: string;
  at: number;
  label: string;
  detail: string;
  ms: number;
  status: "ok" | "blocked" | "failed";
};

export type Trace = {
  id: string;
  conversationId: string;
  prompt: string;
  agent: string;
  model: string;
  poolEntry: string;
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
  byCategory: Array<{ category: GuardrailCategory; count: number }>;
};

export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt?: number;
  revoked: boolean;
};

/** Hardware the pool scheduler admits models against. */
export type Host = {
  gpu: string;
  vramTotalGb: number;
  parallel: number;
  ollamaUrl: string;
  version: string;
};

export type TurnResult =
  | { status: "ok"; traceId: string }
  | { status: "blocked"; guardrail: GuardrailCategory }
  | { status: "error"; reason: string };

// ── Mock backend ──────────────────────────────────────────────────────────

const STORAGE_KEY = "lolo.mock.v1";

type MockState = {
  session: Session | null;
  conversations: Conversation[];
  messages: Message[];
  pool: PoolEntry[];
  traces: Trace[];
  findings: Finding[];
  keys: ApiKey[];
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function seed(): MockState {
  const now = Date.now();
  const yesterday = now - DAY;

  return {
    session: null,
    conversations: [
      {
        id: "c1",
        title: "Rancang schema Postgres untuk Lolo",
        agent: "builder",
        model: "qwen2.5-coder:7b",
        updatedAt: now - 12 * MIN,
      },
      {
        id: "c2",
        title: "Bandingkan Qwen3 vs Gemma3 12B",
        agent: "researcher",
        model: "llama3.1:8b",
        updatedAt: yesterday,
      },
      {
        id: "c3",
        title: "Audit guardrail rules",
        agent: "redteam",
        model: "gemma3:12b",
        updatedAt: yesterday - 3 * HOUR,
      },
    ],
    messages: [
      {
        id: "m1",
        conversationId: "c1",
        role: "user",
        content:
          "Bikin skema Postgres untuk app AI agent multi-user. Perlu nyimeng chat, dan tiap user punya API key sendiri.",
        agent: "builder",
        createdAt: now - 14 * MIN,
      },
      {
        id: "m2",
        conversationId: "c1",
        role: "assistant",
        content:
          "Delapan tabel. Ringkasnya:\n\n- `users` — akun + role admin/user\n- `sessions` — token hash, bukan token mentah\n- `magic_links` — hash + `used_at`, sekali pakai\n- `conversations` / `messages` — chat, `messages` nunjukin `conversation_id`\n- `model_pool` — scheduler: health, in_flight, cooldown\n- `usage_events` — metrik per request\n- `api_keys` — `secret_hash`, raw-nya cuma tampil saat dibuat\n\nYang paling sering kelupaan: `api_keys.secret` WAJIB di-hash. Kalau disimpan mentah, sekali bocor semua key langsung mati.",
        agent: "builder",
        model: "qwen2.5-coder:7b",
        latencyMs: 4310,
        tokensIn: 812,
        tokensOut: 247,
        createdAt: now - 12 * MIN,
      },
    ],
    pool: [
      {
        id: "p1",
        name: "qwen3-8b",
        tag: "qwen3:8b",
        status: "healthy",
        health: 96,
        inFlight: 0,
        maxParallel: 2,
        vramGb: 6,
        successes: 184,
        failures: 3,
        lastUsedAt: now - 8 * MIN,
      },
      {
        id: "p2",
        name: "qwen-coder",
        tag: "qwen2.5-coder:7b",
        status: "healthy",
        health: 91,
        inFlight: 1,
        maxParallel: 2,
        vramGb: 6,
        successes: 132,
        failures: 6,
        lastUsedAt: now - 12 * MIN,
      },
      {
        id: "p3",
        name: "llama31-8b",
        tag: "llama3.1:8b",
        status: "healthy",
        health: 88,
        inFlight: 0,
        maxParallel: 2,
        vramGb: 6,
        successes: 96,
        failures: 4,
        lastUsedAt: yesterday,
      },
      {
        id: "p4",
        name: "gemma3-12b",
        tag: "gemma3:12b",
        status: "cooling",
        health: 64,
        inFlight: 0,
        maxParallel: 1,
        vramGb: 10,
        successes: 41,
        failures: 11,
        cooldownUntil: now + 4 * MIN,
        lastUsedAt: now - 31 * MIN,
      },
      {
        id: "p5",
        name: "deepseek-r1",
        tag: "deepseek-r1:14b",
        status: "degraded",
        health: 52,
        inFlight: 0,
        maxParallel: 1,
        vramGb: 11,
        successes: 18,
        failures: 14,
        lastUsedAt: yesterday - 5 * HOUR,
      },
    ],
    traces: [
      {
        id: "t1",
        conversationId: "c1",
        prompt: "Bikin skema Postgres untuk app AI agent multi-user…",
        agent: "builder",
        model: "qwen2.5-coder:7b",
        poolEntry: "qwen-coder",
        ok: true,
        totalMs: 4310,
        tokensIn: 812,
        tokensOut: 247,
        steps: [
          { id: "s1", at: now - 14 * MIN, label: "guardrail", detail: "clean", ms: 1, status: "ok" },
          { id: "s2", at: now - 14 * MIN, label: "pool", detail: "claimed qwen-coder", ms: 3, status: "ok" },
          { id: "s3", at: now - 13 * MIN, label: "load model", detail: "already resident", ms: 40, status: "ok" },
          { id: "s4", at: now - 13 * MIN, label: "generate", detail: "247 tokens", ms: 4266, status: "ok" },
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
  };
}

function load(): MockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as MockState;
  } catch {
    // Corrupt or unavailable storage falls through to a fresh seed.
  }
  return seed();
}

function save(state: MockState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Preview runs in a sandbox where storage can be blocked; the app still
    // works, it just forgets between reloads.
  }
}

let state = load();
const listeners = new Set<() => void>();

function commit() {
  save(state);
  listeners.forEach((fn) => fn());
}

function uid(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const HOST: Host = {
  gpu: "NVIDIA RTX 3060 12GB",
  vramTotalGb: 12,
  parallel: 2,
  ollamaUrl: "http://localhost:11434",
  version: "0.5.4",
};

/** Canned replies, so the preview shows a real conversation shape. */
const REPLIES: Record<string, (prompt: string) => string> = {
  lolo: (p) =>
    `Gw sudah memecah ini jadi tiga bagian, dan urutannya penting.\n\n` +
    `**1. Apa yang sebenarnya lo mau**\nAmbil dari kalimat terakhir lo — "${p.slice(0, 60)}…". Itu inti permintaannya.\n\n` +
    `**2. Apa yang belum jelas**\nSpesifikasi dan batasannya belum disebut. Tanpa itu, tebakan saya bisa meleset.\n\n` +
    `**3. Langkah berikutnya**\nJawab tiga pertanyaan di atas, nanti saya lempar ke spesialis yang paling pas — bukan nebak-nebak dulu.\n\n` +
    `_Reroute: 2 spesialis dipanggil. Trace lengkap ada di tab Trace._`,

  researcher: (p) =>
    `**Fakta**\nSemua model di pool ini jalan lokal lewat Ollama, jadi tidak ada data yang keluar dari mesin lo.\n\n` +
    `**Asumsi**\nSaya asumsikan "${p.slice(0, 40)}…" ini pertanyaan lanjutan, bukan permintaan bikin sistem baru. Kalau salah, koreksi saya.\n\n` +
    `**Yang belum saya tahu**\nBatas VRAM lo. Itu yang menentukan model mana yang bisa masuk pool — bukan preferensi.\n\n` +
    `_Rekomendasi: Qwen3 8B untuk harian, Gemma 3 12B untuk reasoning berat. Jangan dua-duanya kalau VRAM cuma 12GB, salah satu akan ke-evict tiap kali ganti._`,

  builder: (p) =>
    `Oke, ini rancangan kasar buat "${p.slice(0, 50)}…".\n\n` +
    "```ts\n" +
    `// scheduler: pilih model yang muat di VRAM dan punya slot kosong\n` +
    `function pick(entries: PoolEntry[], vram: number): PoolEntry | null {\n` +
    `  return entries\n` +
    `    .filter((e) => e.status === "healthy")\n` +
    `    .filter((e) => e.inFlight < e.maxParallel)\n` +
    `    .sort((a, b) => a.vramGb - b.vramGb || b.health - a.health)\n` +
    `    .find((e) => e.vramGb <= vram) ?? null;\n` +
    `}\n` +
    "```\n\n" +
    `**Edge case yang gue tanganin**\n- Semua model muat → ambil yang VRAM-nya paling kecil, biar sisanya masih ada ruang.\n- Nggak ada yang muat → jangan crash, kembalikan \`null\` supaya UI bisa nambah model.\n- Cooling → kasih tahu, jangan lewatkan diam-diam.\n\n` +
    `**Belum gue kerjain**: kuota. Kalau satu user ngabisin VRAM, user lain numpang antre. Itu butuh batas per-user, bukan per-model.`,

  redteam: (p) =>
    `Saya serang "${p.slice(0, 50)}…" dan menemukan 4 hal.\n\n` +
    `**1. Prompt injection — tinggi**\nAda frasa yang, kalau disisipkan ke konten yang di-retrieve, bisa menimpa instruksi sistem. Rules lo kena polanya, tapi hanya yang literal.\n\n` +
    `**2. Excessive agency — tinggi**\nNggak ada batas jelas antara "nilai yang lo minta" dan "nilai yang agent boleh akses sendiri". Kalau nanti agent dikasih tool, ini jadi celah.\n\n` +
    `**3. Guardrail blindness — sedang**\nFilter lo cuma jalan di prompt masuk. Kalau model balancer atau reviewer diawasi lewat lapisan sendiri, jalur itu belum difilter.\n\n` +
    `**4. PII leakage — sedang**\nRegex email dan nomor HP masih kepicu buat nomor versi. False positive, tapi bakal bikin user kesal.\n\n` +
    `Yang paling saya khawatirkan bukan poin di atas — itu semua yang sudah lo tangani. Yang belum ada: **nggak ada cara tahu kalau saya sendiri lagi di-inject.** Itu butuh judge yang terpisah, bukan agent yang sama yang lagi diperiksa.`,
};

function mockApi() {
  return {
    async host(): Promise<Host> {
      return HOST;
    },

    async requestMagicLink(email: string): Promise<void> {
      await wait(500);
      const name = email.split("@")[0]!.replace(/[._-]/g, " ");
      state.session = {
        email,
        name: name.replace(/\b\w/g, (c) => c.toUpperCase()),
        // The first account to sign in runs the server; the rest are users.
        role: state.keys.length === 0 && email.startsWith("a") ? "admin" : "user",
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
        model: model ?? MODELS[0]!.tag,
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

    async pool(): Promise<{ entries: PoolEntry[]; summary: PoolSummary }> {
      const now = Date.now();
      const entries = state.pool.map((e) => ({
        ...e,
        status:
          e.cooldownUntil !== undefined && e.cooldownUntil > now
            ? ("cooling" as PoolStatus)
            : e.status,
      }));
      const healthy = entries.filter((e) => e.status === "healthy");
      return {
        entries,
        summary: {
          total: entries.length,
          healthy: healthy.length,
          freeSlots: healthy.reduce(
            (sum, e) => sum + Math.max(0, e.maxParallel - e.inFlight),
            0,
          ),
          totalSlots: entries.reduce((s, e) => s + e.maxParallel, 0),
          avgHealth: entries.length
            ? Math.round(entries.reduce((s, e) => s + e.health, 0) / entries.length)
            : 0,
          vramUsedGb: entries
            .filter((e) => e.status !== "disabled")
            .reduce((s, e) => s + e.vramGb, 0),
          vramTotalGb: HOST.vramTotalGb,
        },
      };
    },

    async setPoolStatus(id: string, status: PoolStatus): Promise<void> {
      const e = state.pool.find((x) => x.id === id);
      if (!e) return;
      e.status = status;
      if (status === "healthy") {
        e.health = 100;
        e.cooldownUntil = undefined;
      }
      if (status === "disabled") e.inFlight = 0;
      commit();
    },

    async addPoolEntry(tag: string): Promise<void> {
      if (state.pool.some((e) => e.tag === tag)) return;
      const m = getModel(tag);
      state.pool.push({
        id: uid("p"),
        name: m.label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        tag: m.tag,
        status: "healthy",
        health: 100,
        inFlight: 0,
        maxParallel: 2,
        vramGb: m.vramGb,
        successes: 0,
        failures: 0,
      });
      commit();
    },

    async removePoolEntry(id: string): Promise<void> {
      state.pool = state.pool.filter((e) => e.id !== id);
      commit();
    },

    async traces(): Promise<Trace[]> {
      return [...state.traces].sort((a, b) => b.steps[0]!.at - a.steps[0]!.at);
    },

    async usage(): Promise<UsageStats> {
      const total = state.pool.reduce((s, e) => s + e.successes + e.failures, 0);
      const failed = state.pool.reduce((s, e) => s + e.failures, 0);
      return {
        requests: total,
        tokensIn: total * 412,
        tokensOut: total * 138,
        failed,
        avgLatencyMs: 3890,
        perModel: state.pool
          .map((e) => ({ model: e.tag, count: e.successes + e.failures }))
          .sort((a, b) => b.count - a.count),
        perAccount: state.pool.map((e) => ({
          label: e.name,
          ok: e.successes,
          failed: e.failures,
        })),
      };
    },

    async findings(): Promise<FindingsResult> {
      const byCategory = new Map<GuardrailCategory, number>();
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
     * The full turn pipeline, running against the mock: screen, claim a pool
     * slot, "generate", settle, record. Same steps the Hono server will run.
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

      const userMessage: Message = {
        id: uid("m"),
        conversationId: args.conversationId,
        role: "user",
        content: args.prompt,
        agent: args.agent,
        createdAt: started,
      };
      state.messages.push(userMessage);
      const conv = state.conversations.find((c) => c.id === args.conversationId);
      if (conv) {
        conv.updatedAt = started;
        if (conv.title === "New run") conv.title = args.prompt.slice(0, 60);
      }

      // 1 — guardrail
      const finding = screen(args.prompt, "input");
      push(
        "guardrail",
        finding ? `${finding.category} · ${finding.severity}` : "clean",
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
        const trace: Trace = {
          id: uid("t"),
          conversationId: args.conversationId,
          prompt: args.prompt,
          agent: args.agent,
          model: args.model,
          poolEntry: "—",
          ok: false,
          totalMs: Date.now() - started,
          tokensIn: 0,
          tokensOut: 0,
          steps,
        };
        state.traces.unshift(trace);
        commit();
        return { status: "blocked", guardrail: finding.category };
      }

      // 2 — claim a pool slot
      const entry = state.pool.find(
        (e) => e.tag === args.model && e.status !== "disabled",
      );
      if (!entry) {
        const reason = `Model ${args.model} isn't in the pool. Add it from the server panel.`;
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

      if (entry.inFlight >= entry.maxParallel) {
        const reason = `No free slot on ${entry.name} right now. Every model in the pool is busy — wait for a turn to finish.`;
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

      entry.inFlight += 1;
      const model = getModel(args.model);
      const buildMs = model.vramGb > 8 ? 3800 : 420;
      const genMs = 1800 + Math.min(4200, args.prompt.length * 9);
      push("pool", `claimed ${entry.name}`, 3, "ok");
      push(
        "load model",
        buildMs > 500 ? "cold start" : "already resident",
        buildMs,
        "ok",
      );

      await wait(700);
      push("generate", `${args.prompt.length} chars in`, genMs, "ok");

      // 3 — settle the slot
      entry.inFlight = Math.max(0, entry.inFlight - 1);
      entry.successes += 1;
      entry.health = Math.min(100, entry.health + 1);
      entry.lastUsedAt = Date.now();

      const replyFn = REPLIES[args.agent] ?? REPLIES.lolo!;
      const tokensIn = 380 + args.prompt.length;
      const tokensOut = 120 + replyFn(args.prompt).length;

      state.messages.push({
        id: uid("m"),
        conversationId: args.conversationId,
        role: "assistant",
        content: replyFn(args.prompt),
        agent: args.agent,
        model: args.model,
        latencyMs: buildMs + genMs,
        tokensIn,
        tokensOut,
        createdAt: Date.now(),
      });

      const trace: Trace = {
        id: uid("t"),
        conversationId: args.conversationId,
        prompt: args.prompt,
        agent: args.agent,
        model: args.model,
        poolEntry: entry.name,
        ok: true,
        totalMs: buildMs + genMs,
        tokensIn,
        tokensOut,
        steps,
      };
      state.traces.unshift(trace);
      commit();
      return { status: "ok", traceId: trace.id };
    },
  };
}

export type Api = ReturnType<typeof mockApi>;

// ── Real backend (used once the Hono server exists) ───────────────────────
//
// Same signatures as `mockApi`, so the app imports `api` and never learns
// which one it is talking to. Swap the export at the bottom of this file.

const BASE = import.meta.env.VITE_API_URL ?? "";

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
    host: () => get<Host>("/api/host"),
    requestMagicLink: (email: string) => send<void>("/api/auth/magic-link", "POST", { email }),
    session: () => get<Session | null>("/api/me"),
    signOut: () => send<void>("/api/auth/logout", "POST"),
    listConversations: () => get<Conversation[]>("/api/conversations"),
    createConversation: (agent?: string, model?: string) =>
      send<Conversation>("/api/conversations", "POST", { agent, model }),
    updateConversation: (id: string, patch: { agent?: string; model?: string }) =>
      send<void>(`/api/conversations/${id}`, "PATCH", patch),
    deleteConversation: (id: string) =>
      send<void>(`/api/conversations/${id}`, "DELETE"),
    listMessages: (id: string) => get<Message[]>(`/api/conversations/${id}/messages`),
    pool: () => get<{ entries: PoolEntry[]; summary: PoolSummary }>("/api/pool"),
    setPoolStatus: (id: string, status: PoolStatus) =>
      send<void>(`/api/pool/${id}`, "PATCH", { status }),
    addPoolEntry: (tag: string) => send<void>("/api/pool", "POST", { tag }),
    removePoolEntry: (id: string) => send<void>(`/api/pool/${id}`, "DELETE"),
    traces: () => get<Trace[]>("/api/traces"),
    usage: () => get<UsageStats>("/api/usage"),
    findings: () => get<FindingsResult>("/api/guardrails"),
    listKeys: () => get<ApiKey[]>("/api/keys"),
    createKey: (name: string) => send<{ id: string; secret: string }>("/api/keys", "POST", { name }),
    revokeKey: (id: string) => send<void>(`/api/keys/${id}`, "DELETE"),
    runTurn: (args: { conversationId: string; prompt: string; agent: string; model: string }) =>
      send<TurnResult>("/api/turn", "POST", args),
  };
}

/**
 * `mock` keeps the preview explorable with no server attached. Set
 * `VITE_API_MODE=http` once the Hono + PostgreSQL server is running and the
 * whole app talks to the real database instead.
 */
export const api: Api =
  import.meta.env.VITE_API_MODE === "http" ? httpApi() : mockApi();

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export { AGENTS, MODELS, getAgent, GUARDRAIL_LABELS };
