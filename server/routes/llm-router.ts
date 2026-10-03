// The LLM router.
//
// One OpenAI-shaped endpoint in front of every provider the app can reach, so
// the chat never talks to a vendor directly. Two providers are wired:
//
//   ollama      — local, needs no key, always tried first
//   openrouter  — remote, needs a key, serves the free-tier models
//
// The routing decision is a pure function (`selectProvider`) so it can be
// tested without a network or a key. Nothing here invents a credential: the
// OpenRouter key is read from the environment (the Keys tab), and when it is
// absent the router degrades to local models rather than failing.

import { Hono } from "hono";

export type ProviderId = "ollama" | "openrouter";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatRequest = {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
};

export type ChatChunk = {
  provider: ProviderId;
  model: string;
  content: string;
};

/**
 * Free-tier OpenRouter models. OpenRouter retires `:free` models fairly often,
 * so this is a default to be overridden with `OPENROUTER_MODEL`, not a promise
 * that each of these is available right now.
 */
export const OPENROUTER_FREE_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemini-2.0-flash-exp:free",
  "deepseek/deepseek-chat-v3-0324:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "qwen/qwen-2.5-72b-instruct:free",
] as const;

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OLLAMA_BASE = "http://127.0.0.1:11434";

/** Local models the existing Ollama pool already knows about. */
export const LOCAL_MODELS = ["qwen2.5-coder:7b", "llama3.1:8b", "qwen2.5:7b"] as const;
export const DEFAULT_LOCAL_MODEL = LOCAL_MODELS[0];

export type RouterConfig = {
  openrouterKey: string;
  /** Override the free-model list from the environment. */
  openrouterModel?: string;
  localBase?: string;
  /** Force a provider regardless of availability (used by tests). */
  force?: ProviderId;
};

/**
 * Choose a provider for a request.
 *
 * Pure: given the same inputs it always returns the same answer, which is what
 * makes the policy testable without a socket or an API key.
 */
export function selectProvider(
  cfg: RouterConfig,
  requested?: string,
): { provider: ProviderId; model: string; reason: string } {
  if (cfg.force) {
    return {
      provider: cfg.force,
      model: requested ?? defaultModelFor(cfg, cfg.force),
      reason: "forced by config",
    };
  }

  const wantOpenRouter = requested?.startsWith("openrouter/");
  const wantLocal = requested?.startsWith("ollama/") || (requested && LOCAL_MODELS.includes(requested as never));

  if (wantOpenRouter) {
    if (!cfg.openrouterKey) {
      return { provider: "ollama", model: strip(requested!), reason: "openrouter needs a key; using local" };
    }
    return { provider: "openrouter", model: strip(requested!), reason: "explicitly requested" };
  }

  if (wantLocal) {
    return { provider: "ollama", model: strip(requested!), reason: "explicitly requested" };
  }

  // Default policy: local first because it is free and private, remote only
  // when a key is actually configured.
  if (!cfg.openrouterKey) {
    return { provider: "ollama", model: DEFAULT_LOCAL_MODEL, reason: "no remote key configured" };
  }
  return {
    provider: "openrouter",
    model: cfg.openrouterModel ?? OPENROUTER_FREE_MODELS[0],
    reason: "remote key configured",
  };
}

function strip(model: string): string {
  return model.replace(/^openrouter\//, "").replace(/^ollama\//, "");
}

function defaultModelFor(cfg: RouterConfig, provider: ProviderId): string {
  return provider === "openrouter"
    ? cfg.openrouterModel ?? OPENROUTER_FREE_MODELS[0]
    : DEFAULT_LOCAL_MODEL;
}

export type FetchLike = typeof fetch;

async function callOpenRouter(
  cfg: RouterConfig,
  model: string,
  messages: ChatMessage[],
  opts: { temperature?: number; max_tokens?: number },
  doFetch: FetchLike,
): Promise<ChatChunk> {
  const res = await doFetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.openrouterKey}`,
      "Content-Type": "application/json",
      // OpenRouter attributes traffic to an app when these are set.
      "HTTP-Referer": "https://lolo.ai",
      "X-Title": "Lolo Agent",
    },
    body: JSON.stringify({ model, messages, ...opts }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`openrouter ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return { provider: "openrouter", model, content: json.choices?.[0]?.message?.content ?? "" };
}

async function callOllama(
  cfg: RouterConfig,
  model: string,
  messages: ChatMessage[],
  opts: { temperature?: number; max_tokens?: number },
  doFetch: FetchLike,
): Promise<ChatChunk> {
  const base = cfg.localBase ?? OLLAMA_BASE;
  const res = await doFetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      ...(opts.temperature === undefined ? {} : { options: { temperature: opts.temperature } }),
      ...(opts.max_tokens === undefined ? {} : { options: { num_predict: opts.max_tokens } }),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ollama ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { message?: { content?: string } };
  return { provider: "ollama", model, content: json.message?.content ?? "" };
}

/**
 * Run a chat completion, falling back to the other provider if the preferred
 * one errors. Returns which provider actually answered.
 */
export async function routeChat(
  cfg: RouterConfig,
  req: ChatRequest,
  doFetch: FetchLike = fetch,
): Promise<ChatChunk & { fellBack: boolean; note: string }> {
  const pick = selectProvider(cfg, req.model);
  const opts = { temperature: req.temperature, max_tokens: req.max_tokens };
  const call = pick.provider === "openrouter" ? callOpenRouter : callOllama;

  try {
    const out = await call(cfg, pick.model, req.messages, opts, doFetch);
    return { ...out, fellBack: false, note: pick.reason };
  } catch (primaryErr) {
    const other: ProviderId = pick.provider === "openrouter" ? "ollama" : "openrouter";
    // A remote fallback is only possible when a key exists; otherwise surface
    // the original failure rather than pretending a model answered.
    if (other === "openrouter" && !cfg.openrouterKey) {
      throw new Error(
        `${(primaryErr as Error).message} — and no OpenRouter key is configured to fall back to.`,
      );
    }
    const model = defaultModelFor(cfg, other);
    const fallbackCall = other === "openrouter" ? callOpenRouter : callOllama;
    try {
      const out = await fallbackCall(cfg, model, req.messages, opts, doFetch);
      return { ...out, fellBack: true, note: `${pick.provider} failed, fell back to ${other}` };
    } catch (fallbackErr) {
      throw new Error(
        `${pick.provider}: ${(primaryErr as Error).message} | ${other}: ${(fallbackErr as Error).message}`,
      );
    }
  }
}

/** The HTTP surface: an OpenAI-compatible /v1/chat/completions. */
export function llmRouter(configFromEnv: () => RouterConfig) {
  const app = new Hono();

  app.get("/v1/models", (c) => {
    const cfg = configFromEnv();
    const models = [
      ...LOCAL_MODELS.map((id) => ({ id: `ollama/${id}`, provider: "ollama" })),
      ...(cfg.openrouterKey ? [OPENROUTER_FREE_MODELS[0]].map((id) => ({ id: `openrouter/${id}`, provider: "openrouter" })) : []),
    ];
    return c.json({ object: "list", data: models });
  });

  app.post("/v1/chat/completions", async (c) => {
    const cfg = configFromEnv();
    const body = await c.req.json<ChatRequest>();
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: { message: "messages[] is required" } }, 400);
    }
    try {
      const out = await routeChat(cfg, body);
      return c.json({
        id: `lolo-${Date.now()}`,
        object: "chat.completion",
        model: out.model,
        choices: [
          { index: 0, message: { role: "assistant", content: out.content }, finish_reason: "stop" },
        ],
        // Non-standard, but this app needs to know what actually answered.
        lolo: { provider: out.provider, fellBack: out.fellBack, note: out.note },
      });
    } catch (e) {
      return c.json(
        { error: { message: e instanceof Error ? e.message : String(e) } },
        502,
      );
    }
  });

  return app;
}