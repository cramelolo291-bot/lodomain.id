// The Lolo AI catalog, cloned from the upstream projects.
//
// Model rows, access tiers, reasoning-effort support and the gateway's
// slot/concurrency limits are taken verbatim from the freebuff model catalog
// and the Freebuff-2API compatibility matrix, so the UI shows the same
// catalogue the gateway actually implements.
//
// Pure data with no imports, so the browser and the Hono server read from one
// source.

export type Accent = "cool" | "warm";

/** freebuff exposes two access levels; Freebuff-2API gives them different
 *  capacity. Free gets one slot at a time, subscribed gets three. */
export type Access = "full" | "limited" | "paid";

export type Tier = "free" | "subscribed";

/** Reasoning effort, as accepted by the upstream model. An empty list means
 *  the model does not support the field and the gateway strips it. */
export type Effort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ModelDef = {
  /** Wire id sent to /v1/chat/completions. */
  id: string;
  label: string;
  /** Who runs it. */
  vendor: string;
  access: Access;
  bestFor: string;
  contextK: number;
  /** True when the model takes images as well as text. */
  vision: boolean;
  /** Modalities beyond text, where the upstream supports them. */
  extra?: string;
  efforts: Effort[];
  /** Daily free hours drawn from the shared Freebucks allowance. */
  freeHours: number;
  /** True when the model draws nothing from the daily allowance. */
  unmetered: boolean;
  accent: Accent;
};

/**
 * The regular picker, exactly as freebuff publishes it. Gemini 3.1 Flash Lite
 * is deliberately excluded: upstream keeps it out of the picker and reserves it
 * for specialist work like file finding and research.
 */
export const MODELS: ModelDef[] = [
  {
    id: "z-ai/glm-5.3-flash",
    label: "GLM 5.3 Flash",
    vendor: "Z.ai",
    access: "full",
    bestFor: "The default everywhere. Deepest reasoning, unmetered.",
    contextK: 524,
    vision: false,
    efforts: ["low", "high", "max"],
    freeHours: 20,
    unmetered: false,
    accent: "warm",
  },
  {
    id: "deepseek/deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    vendor: "DeepSeek",
    access: "full",
    bestFor: "Fast coding and tool use, unmetered.",
    contextK: 128,
    vision: false,
    efforts: ["low", "high", "max"],
    freeHours: 10,
    unmetered: false,
    accent: "cool",
  },
  {
    id: "openai/gpt-6-luna",
    label: "GPT-6 Luna",
    vendor: "OpenAI",
    access: "full",
    bestFor: "Strong all-round work with native images. Runs on flex capacity.",
    contextK: 128,
    vision: true,
    efforts: ["low", "medium", "high", "xhigh", "max"],
    freeHours: 5,
    unmetered: false,
    accent: "cool",
  },
  {
    id: "mimo/mimo-2.6-flash",
    label: "MiMo 2.6 Flash",
    vendor: "Xiaomi",
    access: "full",
    bestFor: "Balanced performance with image support.",
    contextK: 128,
    vision: true,
    efforts: [],
    freeHours: 10,
    unmetered: false,
    accent: "cool",
  },
  {
    id: "mimo/mimo-2.6-pro",
    label: "MiMo 2.6 Pro",
    vendor: "Xiaomi",
    access: "full",
    bestFor: "The stronger reasoning model, images included.",
    contextK: 128,
    vision: true,
    efforts: [],
    freeHours: 3,
    unmetered: false,
    accent: "warm",
  },
  {
    id: "solar/solar-mini-4",
    label: "Solar Mini 4",
    vendor: "Upstage",
    access: "full",
    bestFor: "Fast and compact. 524K context, text only.",
    contextK: 524,
    vision: false,
    efforts: [],
    freeHours: 20,
    unmetered: false,
    accent: "cool",
  },
  {
    id: "solar/solar-pro4",
    label: "Solar Pro 4",
    vendor: "Upstage",
    access: "full",
    bestFor: "The larger, stronger Solar. 524K context, text only.",
    contextK: 524,
    vision: false,
    efforts: [],
    freeHours: 10,
    unmetered: false,
    accent: "warm",
  },
  {
    id: "stealth/ox-alpha",
    label: "Space Bunny Alpha",
    vendor: "Undisclosed",
    access: "full",
    bestFor: "Beta. A stealth model that retains prompts. 1M context, images.",
    contextK: 1024,
    vision: true,
    efforts: ["low", "high", "max"],
    freeHours: 0,
    unmetered: true,
    accent: "warm",
  },
  {
    id: "google/gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    vendor: "Google",
    access: "paid",
    bestFor: "1M context, and the only model that takes audio, video and PDF.",
    contextK: 1024,
    vision: true,
    extra: "audio · video · pdf",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    freeHours: 0,
    unmetered: false,
    accent: "cool",
  },
  {
    id: "meta/muse-spark-1.2",
    label: "Muse Spark 1.2",
    vendor: "Meta",
    access: "full",
    bestFor: "Agentic coding. 1M context, but rate limited and shared.",
    contextK: 1024,
    vision: false,
    efforts: ["minimal", "low", "medium", "high", "xhigh"],
    freeHours: 6,
    unmetered: false,
    accent: "cool",
  },
];

/**
 * The daily allowance, as freebuff publishes it: 100 Freebucks a day, refilled
 * at midnight Pacific, not carried over. Hours-per-model are what the whole
 * allowance buys on that one model, so they are not additive.
 */
export const DAILY_FREEBUCKS = 100;

/**
 * Models the effort matrix says to strip. Kept alongside the picker because
 * Freebuff-2API routes them and strips the field rather than erroring.
 */
export const NO_EFFORT_MODELS = [
  "solar-pro4",
  "minimax-m3",
  "mimo-v2.5",
  "kimi-k3",
] as const;

/** Reserved for specialist work; hidden from the picker, as upstream does. */
export const SPECIALIST_MODELS: ModelDef[] = [
  {
    id: "google/gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    vendor: "Google",
    access: "full",
    bestFor: "Specialist tasks: file finding and research.",
    contextK: 1024,
    vision: true,
    efforts: [],
    freeHours: 0,
    unmetered: true,
    accent: "cool",
  },
];

export const DEFAULT_MODEL = MODELS[0]!.id;

export function getModel(id: string): ModelDef {
  return (
    [...MODELS, ...SPECIALIST_MODELS].find((m) => m.id === id) ?? MODELS[0]!
  );
}

/** Freebuff-2API capacity per access tier. Actual concurrency is capped by the
 *  slot count: the free pool is effectively serial, subscribed allows three. */
export const TIER_LIMITS: Record<Tier, { slots: number; concurrency: number }> = {
  free: { slots: 1, concurrency: 3 },
  subscribed: { slots: 3, concurrency: 8 },
};

export const ACCESS_LABEL: Record<Access, string> = {
  full: "Full access",
  limited: "Limited access",
  paid: "Paid plans",
};

/** Upstream heartbeat interval that keeps a session's quota alive. */
export const KEEPALIVE_MS = 45_000;
/** How long a 429 makes the caller wait before retrying. */
export const QUEUE_RETRY_MS = 2_000;

/**
 * What a self-hosted agent gateway displaces, at the list prices the vendors
 * publish. Used for the comparison section; nothing here is a claim about
 * Lolo, only about the alternatives.
 */
export const ALTERNATIVES = [
  { name: "Devin", price: 2400 },
  { name: "Claude Code", price: 1200 },
  { name: "Cursor", price: 720 },
  { name: "Codex", price: 240 },
  { name: "OpenCode", price: 120 },
] as const;

/** The agents freebuff ships, used as the specialist roster. */
export type AgentDef = {
  key: string;
  name: string;
  tagline: string;
  description: string;
  systemPrompt: string;
  accent: Accent;
  order: number;
};

/**
 * freebuff's approach is specialised agents rather than one model and one
 * prompt: file-finding agents map the relevant code, implementation and review
 * agents make and check changes, and research agents investigate. Lolo splits
 * that same shape across four specialists.
 */
export const AGENTS: AgentDef[] = [
  {
    key: "lolo",
    name: "Lolo",
    tagline: "Orchestrator",
    description:
      "Reads the request, decides who should handle it, and returns one answer.",
    systemPrompt:
      "You are Lolo, the orchestrator of a self-hosted agent gateway. Decompose " +
      "the request, decide which specialist is needed, and return a single clear " +
      "answer. Be concrete and brief. Never invent tool output.",
    accent: "warm",
    order: 0,
  },
  {
    key: "scout",
    name: "Scout",
    tagline: "Context finder",
    description:
      "Maps the relevant parts of a codebase before anyone edits, and separates what it knows from what it assumes.",
    systemPrompt:
      "You are Scout, the context-finding agent. Identify the files and regions that " +
      "actually matter for the task and say why. Separate verified facts from guesses. " +
      "Say plainly when you do not know something.",
    accent: "cool",
    order: 1,
  },
  {
    key: "forge",
    name: "Forge",
    tagline: "Implementation & review",
    description:
      "Makes the change, runs it, and inspects the result before handing it back.",
    systemPrompt:
      "You are Forge, the implementation and review agent. Produce working code, not " +
      "pseudocode. Name the file, show the change, list the edge cases you handled, " +
      "and report what the checks actually said.",
    accent: "warm",
    order: 2,
  },
  {
    key: "redteam",
    name: "Red Team",
    tagline: "Adversarial review",
    description:
      "Attacks the system on purpose: injection, leakage, excessive agency, unsafe output.",
    systemPrompt:
      "You are the Red Team agent, modelled on an LLM red-teaming harness. Given a " +
      "prompt or an answer, probe for prompt injection, prompt leakage, PII disclosure, " +
      "excessive agency and unsafe instructions. Return a numbered list with a category, " +
      "a severity of low/medium/high/critical, and a one-line rationale.",
    accent: "cool",
    order: 3,
  },
];

export function getAgent(key: string): AgentDef {
  return AGENTS.find((a) => a.key === key) ?? AGENTS[0]!;
}

/** Which specialist a model is best suited to, by capability rather than name. */
export function preferredAgent(id: string): string {
  if (/coder|code/i.test(id)) return "forge";
  if (/gemini-3\.1-flash-lite/i.test(id)) return "scout";
  if (/gpt-6|qwen3\.8|gemini-3\.8/i.test(id)) return "redteam";
  return "lolo";
}

/**
 * Endpoints the gateway exposes, from the Freebuff-2API route table. Used by
 * the server panel to document the surface a friend's client can call.
 */
export const GATEWAY_ROUTES = [
  { method: "POST", path: "/v1/chat/completions", note: "OpenAI-compatible chat" },
  { method: "POST", path: "/v1/messages", note: "Anthropic-compatible chat" },
  { method: "GET", path: "/v1/models", note: "Model list" },
  { method: "GET", path: "/api/account/balance", note: "Credits and daily allowance" },
  { method: "GET", path: "/api/usage", note: "Requests, tokens, latency, errors" },
  { method: "GET", path: "/healthz", note: "Health check" },
] as const;
