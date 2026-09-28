// Ollama, spoken to directly over HTTP.
//
// Two APIs are used: the native one (`/api/chat`) because it reports real
// `prompt_eval_count` and `eval_count` token counts, and the OpenAI-compatible
// one (`/v1/chat/completions`) for anything that needs to look like a hosted
// provider. Both hit the same local process; no API key, no egress.

import { env } from "../env";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type GenerateResult = {
  content: string;
  /** Real counts from the runtime, not an estimate. */
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  model: string;
};

export class OllamaError extends Error {
  status: number;
  retriable: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OllamaError";
    this.status = status;
    // 429 and 5xx are worth another account. 400 means we asked wrongly.
    this.retriable = status === 429 || status >= 500;
  }
}

async function call(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  const res = await fetch(`${env.OLLAMA_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OllamaError(`Ollama ${path} → ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  return res;
}

function timeoutSignal(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

/** What the machine can actually run. Drives the model list in the UI. */
export type InstalledModel = {
  name: string;
  sizeBytes: number;
  parameterSize: string | null;
  quantization: string | null;
  family: string | null;
};

export async function listModels(): Promise<InstalledModel[]> {
  const { signal, done } = timeoutSignal(10_000);
  try {
    const res = await fetch(`${env.OLLAMA_URL}/api/tags`, { signal });
    if (!res.ok) throw new OllamaError(`Ollama /api/tags → ${res.status}`, res.status);
    const body = (await res.json()) as {
      models?: Array<{
        name: string;
        size?: number;
        details?: {
          parameter_size?: string;
          quantization_level?: string;
          family?: string;
        };
      }>;
    };

    return (body.models ?? []).map((m) => ({
      name: m.name,
      sizeBytes: m.size ?? 0,
      parameterSize: m.details?.parameter_size ?? null,
      quantization: m.details?.quantization_level ?? null,
      family: m.details?.family ?? null,
    }));
  } finally {
    done();
  }
}

export async function isUp(): Promise<boolean> {
  try {
    const { signal, done } = timeoutSignal(2_000);
    const res = await fetch(`${env.OLLAMA_URL}/api/tags`, { signal });
    done();
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Non-streaming generate. `keep_alive` is what stops Ollama unloading the model
 * between requests — without it a 3B model gets evicted and reloaded from disk
 * on every turn, which is seconds of latency for nothing.
 */
export async function chat(
  model: string,
  messages: ChatMessage[],
  opts: { temperature?: number; numCtx?: number; effort?: string } = {},
): Promise<GenerateResult> {
  const started = Date.now();
  const { signal, done } = timeoutSignal(env.OLLAMA_TIMEOUT_MS);

  try {
    const res = await call(
      "/api/chat",
      {
        model,
        messages,
        stream: false,
        keep_alive: `${Math.floor(env.OLLAMA_KEEPALIVE_MS / 1000)}s`,
        options: {
          temperature: opts.temperature ?? 0.7,
          ...(opts.numCtx ? { num_ctx: opts.numCtx } : {}),
        },
      },
      signal,
    );

    const body = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      content: body.message?.content ?? "",
      tokensIn: body.prompt_eval_count ?? 0,
      tokensOut: body.eval_count ?? 0,
      latencyMs: Date.now() - started,
      model,
    };
  } finally {
    done();
  }
}

/**
 * Streaming generate. Returns the full text plus token counts once the stream
 * closes. Used by the SSE route in the turn pipeline.
 */
export async function* chatStream(
  model: string,
  messages: ChatMessage[],
  opts: { temperature?: number; numCtx?: number } = {},
): AsyncGenerator<{ delta: string; done: boolean; result?: GenerateResult }> {
  const started = Date.now();
  const { signal, done: clear } = timeoutSignal(env.OLLAMA_TIMEOUT_MS);

  let tokensIn = 0;
  let tokensOut = 0;
  let full = "";

  try {
    const res = await call(
      "/api/chat",
      {
        model,
        messages,
        stream: true,
        keep_alive: `${Math.floor(env.OLLAMA_KEEPALIVE_MS / 1000)}s`,
        options: {
          temperature: opts.temperature ?? 0.7,
          ...(opts.numCtx ? { num_ctx: opts.numCtx } : {}),
        },
      },
      signal,
    );

    const reader = res.body?.getReader();
    if (!reader) throw new OllamaError("Ollama returned no body", 502);
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done: finished } = await reader.read();
      if (finished) break;

      buffer += decoder.decode(value, { stream: true });
      // Ollama emits newline-delimited JSON; a chunk can hold a partial line.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        let event: {
          message?: { content?: string };
          done?: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
        };
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }

        const delta = event.message?.content ?? "";
        if (delta) {
          full += delta;
          yield { delta, done: false };
        }

        if (event.done) {
          tokensIn = event.prompt_eval_count ?? 0;
          tokensOut = event.eval_count ?? 0;
          yield {
            delta: "",
            done: true,
            result: {
              content: full,
              tokensIn,
              tokensOut,
              latencyMs: Date.now() - started,
              model,
            },
          };
        }
      }
    }
  } finally {
    clear();
  }
}
