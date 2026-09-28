// Shared catalog for the Lolo AI agent system.
//
// Pure data with no imports, so the browser and the eventual Hono server read
// from one source. Adding a model here makes it available in the chat picker,
// the server pool, and the OpenAI-compatible /v1/models endpoint.

export type Accent = "cool" | "warm";

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
 * The four specialists Lolo dispatches to. Lolo plans and answers; the other
 * three are what it routes work to.
 */
export const AGENTS: AgentDef[] = [
  {
    key: "lolo",
    name: "Lolo",
    tagline: "Orchestrator",
    description:
      "Plans the work, picks a specialist, and hands back one coherent answer.",
    systemPrompt:
      "You are Lolo, the orchestrator of a small self-hosted agent system. " +
      "Decompose the request, decide which specialist is needed, and return a " +
      "single clear answer. Be concrete and brief. Never invent tool output.",
    accent: "cool",
    order: 0,
  },
  {
    key: "researcher",
    name: "Researcher",
    tagline: "Context & sources",
    description:
      "Gathers context, separates what is known from what is assumed, and says which is which.",
    systemPrompt:
      "You are the Researcher agent. Gather the relevant context, state assumptions " +
      "explicitly, and separate verified facts from guesses. Structure the answer with " +
      "short sections. Say plainly when you do not know something.",
    accent: "cool",
    order: 1,
  },
  {
    key: "builder",
    name: "Builder",
    tagline: "Code & implementation",
    description:
      "Writes and reviews code, handles the failure modes, and ships the smallest working diff.",
    systemPrompt:
      "You are the Builder agent. Produce working code, not pseudocode. Name the file, " +
      "show the change, and list the edge cases you handled. Prefer the smallest change " +
      "that fully solves the problem.",
    accent: "warm",
    order: 2,
  },
  {
    key: "redteam",
    name: "Red Team",
    tagline: "Adversarial review",
    description:
      "Attacks its own system: injection, leakage, excessive agency, unsafe output.",
    systemPrompt:
      "You are the Red Team agent, modelled on an LLM red-teaming harness. Given a " +
      "prompt or answer, probe for prompt injection, prompt leakage, PII disclosure, " +
      "excessive agency and unsafe instructions. Return findings as a numbered list with " +
      "a category, a severity of low/medium/high/critical, and a one-line rationale.",
    accent: "warm",
    order: 3,
  },
];

export function getAgent(key: string): AgentDef {
  return AGENTS.find((a) => a.key === key) ?? AGENTS[0]!;
}

export type ModelDef = {
  /** Ollama tag, used verbatim as the `model` field. */
  tag: string;
  label: string;
  blurb: string;
  /** Approximate VRAM/RAM the weights need, in GB. */
  vramGb: number;
  contextK: number;
  /** What this model is actually good for, shown in the picker. */
  bestFor: string;
  accent: Accent;
};

/**
 * Everything runs on Ollama on the user's own machine. `vramGb` drives the
 * pool scheduler's admission control: a model that will not fit is never
 * dispatched, no matter how healthy it looks.
 */
export const MODELS: ModelDef[] = [
  {
    tag: "qwen3:8b",
    label: "Qwen3 8B",
    blurb: "Default. Best all-round balance for everyday work.",
    vramGb: 6,
    contextK: 32,
    bestFor: "General chat, Indonesian, structured output",
    accent: "cool",
  },
  {
    tag: "qwen2.5-coder:7b",
    label: "Qwen2.5 Coder 7B",
    blurb: "Code-tuned. What the Builder agent gets dispatched onto.",
    vramGb: 6,
    contextK: 32,
    bestFor: "Code generation, refactors, debugging",
    accent: "warm",
  },
  {
    tag: "llama3.1:8b",
    label: "Llama 3.1 8B",
    blurb: "Steady and fast. Good for chatty research turns.",
    vramGb: 6,
    contextK: 128,
    bestFor: "Long context, summarising, Q&A",
    accent: "cool",
  },
  {
    tag: "gemma3:12b",
    label: "Gemma 3 12B",
    blurb: "Strongest reasoner that still fits a 16GB card.",
    vramGb: 10,
    contextK: 32,
    bestFor: "Hard reasoning, the Red Team agent",
    accent: "cool",
  },
  {
    tag: "deepseek-r1:14b",
    label: "DeepSeek R1 14B",
    blurb: "Shows its work. Slow but the best deep answers.",
    vramGb: 11,
    contextK: 32,
    bestFor: "Multi-step math and logic",
    accent: "warm",
  },
];

export const DEFAULT_MODEL = MODELS[0]!.tag;

export function getModel(tag: string): ModelDef {
  return MODELS.find((m) => m.tag === tag) ?? MODELS[0]!;
}

/** Default specialist a given model is best suited to. */
export function preferredAgent(tag: string): string {
  if (tag.includes("coder")) return "builder";
  if (tag.startsWith("deepseek") || tag.startsWith("gemma")) return "redteam";
  if (tag.startsWith("llama")) return "researcher";
  return "lolo";
}
