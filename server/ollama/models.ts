// What the machine can actually run.
//
// The frontend catalogue describes the hosted models; this one describes the
// local machine. They are different lists on purpose: picking a model the
// server has not pulled would fail every turn.
//
// `fallback` is used until `ollama pull` has been run. Point it at whatever is
// most likely to be present, and the first boot message tells the operator
// exactly what to install.

export type LocalModel = {
  /** Ollama tag, sent verbatim to /api/chat. */
  id: string;
  label: string;
  /** Rough VRAM/RAM footprint, for the picker. */
  sizeGb: number;
  contextK: number;
  /** Which agents this model is a good fit for. */
  forAgents: string[];
  bestFor: string;
  vision: boolean;
};

/**
 * Ordered by capability. The first one present on the machine becomes the
 * default, so a fresh install with only one model pulled still works.
 */
export const MAX_MODELS: LocalModel[] = [
  {
    id: "qwen3:8b",
    label: "Qwen3 8B",
    sizeGb: 5.2,
    contextK: 40,
    forAgents: ["lolo", "forge", "scout", "redteam"],
    bestFor: "General work. Good instruction following for its size.",
    vision: false,
  },
  {
    id: "qwen3:30b-a3b",
    label: "Qwen3 30B-A3B",
    sizeGb: 18,
    contextK: 40,
    forAgents: ["lolo", "forge", "scout"],
    bestFor: "Long code edits. MoE, so it runs fast for the quality.",
    vision: false,
  },
  {
    id: "llama3.1:8b",
    label: "Llama 3.1 8B",
    sizeGb: 4.9,
    contextK: 128,
    forAgents: ["lolo", "scout"],
    bestFor: "Long context. The pick when reading a lot of files.",
    vision: false,
  },
  {
    id: "deepseek-r1:14b",
    label: "DeepSeek R1 14B",
    sizeGb: 9,
    contextK: 32,
    forAgents: ["forge", "redteam"],
    bestFor: "Reasoning-heavy review. Slow but thorough.",
    vision: false,
  },
  {
    id: "qwen2.5vl:7b",
    label: "Qwen2.5-VL 7B",
    sizeGb: 6,
    contextK: 32,
    forAgents: ["scout"],
    bestFor: "Screenshots and images.",
    vision: true,
  },
];

export const FALLBACK_MODEL = MAX_MODELS[0]!.id;

export function getLocalModel(id: string): LocalModel {
  return (
    MAX_MODELS.find((m) => m.id === id) ??
    // Ollama tags are often `name:tag` while we list `name:tag` — a mismatch is
    // normal, so pass anything through rather than rejecting it.
    {
      id,
      label: id,
      sizeGb: 0,
      contextK: 8,
      forAgents: ["lolo"],
      bestFor: "Custom model",
      vision: false,
    }
  );
}

export function forAgent(key: string): LocalModel[] {
  const matched = MAX_MODELS.filter((m) => m.forAgents.includes(key));
  return matched.length ? matched : [MAX_MODELS[0]!];
}
