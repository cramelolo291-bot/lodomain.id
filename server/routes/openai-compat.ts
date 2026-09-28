// OpenAI-compatible surface.
//
// The point of running your own server is that any editor or SDK that speaks
// OpenAI can point at it and talk to a model on your own hardware. Same
// endpoints, same request shape, same streaming protocol — the body is just
// produced locally instead of by a vendor.
//
// Auth is `Authorization: Bearer sk-lolo-…`, checked against the hashed keys in
// the database.

import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { apiKeys } from "../db/schema";
import { env } from "../env";
import { verifyApiKey } from "../auth/tokens";
import { listModels } from "../ollama/client";
import { chat, chatStream } from "../ollama/client";
import { MAX_MODELS, getLocalModel } from "../ollama/models";
import { getAgent } from "../../src/lib/catalog";

export const openai = new Hono();

async function authorise(header: string | undefined): Promise<string | null> {
  const secret = header?.replace(/^Bearer\s+/i, "").trim();
  if (!secret) return null;

  const hash = (await import("../auth/tokens")).hashToken(secret);
  const rows = await db
    .select({ id: apiKeys.id, userId: apiKeys.userId })
    .from(apiKeys)
    .where(and(eq(apiKeys.secretHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (!rows[0]) return null;

  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, rows[0].id));

  return rows[0].userId;
}

function error(message: string, type: string, status: 400 | 401 | 404 | 429 | 502 = 400) {
  return { error: { message, type, param: null, code: null } };
}

openai.use("*", async (c, next) => {
  const key = c.req.header("authorization");
  if (!key) {
    return c.json(error("Missing Authorization header", "invalid_request_error", 401), 401);
  }
  const userId = await authorise(key);
  if (!userId) {
    return c.json(error("Invalid API key", "invalid_request_error", 401), 401);
  }
  c.set("session", {
    userId,
    email: "",
    name: "",
    role: "user" as const,
    expiresAt: 0,
  });
  await next();
});

openai.get("/v1/models", async (c) => {
  let installed: string[] = [];
  try {
    installed = (await listModels()).map((m) => m.name);
  } catch {
    // Ollama down: still list the catalogue so clients can see what to install.
    installed = MAX_MODELS.map((m) => m.id);
  }

  const ids = [...new Set([...installed, ...MAX_MODELS.map((m) => m.id)])];
  return c.json({
    object: "list",
    data: ids.map((id) => {
      const local = getLocalModel(id);
      return {
        id,
        object: "model",
        created: 0,
        owned_by: "lolo",
        context_length: local.contextK * 1024,
      };
    }),
  });
});

type ChatBody = {
  model?: string;
  messages?: Array<{ role: string; content: string }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  /** Lolo-specific: which specialist should answer. */
  agent?: string;
};

openai.post("/v1/chat/completions", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as ChatBody;

  if (!body.model || !body.messages?.length) {
    return c.json(error("model and messages are required", "invalid_request_error"), 400);
  }

  const id = `chatcmpl-${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  const wire = body.messages.map((m) => ({
    role: m.role as "system" | "user" | "assistant",
    content: m.content,
  }));

  const local = getLocalModel(body.model);
  // A named agent prefixes the system turn without the caller having to build
  // one, so an editor can just say `agent: "forge"`.
  if (body.agent) {
    const specialist = getAgent(body.agent);
    wire.unshift({
      role: "system",
      content: `${specialist.description}\n\n${specialist.systemPrompt}`,
    });
  }

  if (!body.stream) {
    try {
      const result = await chat(local.id, wire, {
        temperature: body.temperature ?? 0.7,
      });

      return c.json({
        id,
        object: "chat.completion",
        created,
        model: local.id,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: result.content },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: result.tokensIn,
          completion_tokens: result.tokensOut,
          total_tokens: result.tokensIn + result.tokensOut,
        },
      });
    } catch (e) {
      return c.json(
        error(e instanceof Error ? e.message : String(e), "upstream_error", 502),
        502,
      );
    }
  }

  // Streaming. The SSE shape has to match OpenAI's exactly or clients break:
  // a `data:` line per chunk, then `data: [DONE]`.
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const base = { id, object: "chat.completion.chunk", created, model: local.id };

      try {
        for await (const event of chatStream(local.id, wire, {
          temperature: body.temperature ?? 0.7,
        })) {
          if (event.delta) {
            send({ ...base, choices: [{ index: 0, delta: { content: event.delta } }] });
          }
          if (event.done && event.result) {
            send({
              ...base,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              usage: {
                prompt_tokens: event.result.tokensIn,
                completion_tokens: event.result.tokensOut,
                total_tokens: event.result.tokensIn + event.result.tokensOut,
              },
            });
          }
        }
      } catch (e) {
        send({ ...base, error: { message: e instanceof Error ? e.message : String(e) } });
      }

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
});

/** What a client can expect, mirroring the gateway's advertised surface. */
openai.get("/v1", (c) =>
  c.json({
    service: "lolo-ai",
    base: env.APP_URL,
    endpoints: [
      { method: "GET", path: "/v1/models", note: "Installed and expected local models" },
      {
        method: "POST",
        path: "/v1/chat/completions",
        note: "OpenAI-compatible chat, streaming supported",
      },
    ],
  }),
);

export type { sql };
