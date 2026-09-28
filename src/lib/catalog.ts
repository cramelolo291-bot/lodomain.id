// Shared catalog for the Lolo AI agent system.
// Pure data so the Convex runtime and the browser can both import it.

export type AgentAccent = "cool" | "warm";

export type AgentDef = {
  key: string;
  name: string;
  tagline: string;
  description: string;
  systemPrompt: string;
  accent: AgentAccent;
  order: number;
};

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
      "Gathers context, separates what is known from what is assumed, and cites its reasoning.",
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
      "Writes and reviews code, runs through the failure modes, and ships the diff.",
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
  id: string;
  label: string;
  blurb: string;
  contextK: number;
  /** Reasoning effort the upstream model accepts, if any. */
  efforts: string[];
  accent: AgentAccent;
};

/**
 * Models exposed through the gateway. Every id is OpenAI-compatible, so the
 * same catalog works against a local server, a self-hosted proxy, or a hosted API.
 */
export const MODELS: ModelDef[] = [
  {
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B",
    blurb: "Default. Deep reasoning, unmetered on the free pool.",
    contextK: 128,
    efforts: ["low", "high", "max"],
    accent: "cool",
  },
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    blurb: "Strong all-round reasoning with a very long window.",
    contextK: 128,
    efforts: ["low", "medium", "high"],
    accent: "cool",
  },
  {
    id: "qwen/qwen3-32b",
    label: "Qwen3 32B",
    blurb: "Balanced multilingual performance, good at long-form writing.",
    contextK: 128,
    efforts: ["low", "high"],
    accent: "warm",
  },
  {
    id: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B",
    blurb: "Compact and fast. Good default for short utility turns.",
    contextK: 128,
    efforts: ["low", "medium", "high"],
    accent: "warm",
  },
  {
    id: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B",
    blurb: "Lowest latency tier. For previews and cheap fan-out.",
    contextK: 128,
    efforts: [],
    accent: "warm",
  },
];

export const DEFAULT_MODEL = MODELS[0]!.id;

export function getModel(id: string): ModelDef {
  return MODELS.find((m) => m.id === id) ?? MODELS[0]!;
}
