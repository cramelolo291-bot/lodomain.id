// OpenAI-compatible surface.
//
// The point of running your own server is that any editor or SDK that speaks
// OpenAI can point at it and talk to a model on your own hardware. Same
// endpoints, same request shape, same streaming protocol — the body is just
// produced locally instead of by a vendor.
//
// Auth is `Authorization: Bearer sk-lolo-…`, checked against the hashed keys in
// the database.

import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { apiKeys, users } from "../db/schema";
import { env } from "../env";
import { hashToken } from "../auth/tokens";
import { isAllowedLoginEmail } from "../auth/magic-link";
import { chat, chatStream, listModels } from "../ollama/client";
import { MAX_MODELS, getLocalModel } from "../ollama/models";
import { getAgent } from "../../src/lib/catalog";
import { chatBody } from "../http/validate";

declare module "hono" {
  interface ContextVariableMap {
    keyUserId: string;
  }
}

export const openai = new Hono();

async function authorise(header: string | undefined): Promise<string | null> {
  const secret = header?.replace(/^Bearer\s+/i, "").trim();
  if (!secret) return null;

  const hash = hashToken(secret);
  const rows = await db
    .select({ id: apiKeys.id, userId: apiKeys.userId, email: users.email })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .where(and(eq(apiKeys.secretHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);

  const key = rows[0];
  if (!key) return null;

  if (!isAllowedLoginEmail(key.email)) {
    // An address removed from the production allowlist loses both session and
    // SDK access. Revoke every key for that owner, not just this one.
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.userId, key.userId));
    return null;
  }

  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id));

  return key.userId;
}

/**
 * Authentication is applied per handler rather than as a router-wide
 * middleware. This router is mounted at `/`, so a `use("*")` here would guard
 * every path in the app — including the frontend, which would then serve 401 to
 * every visitor.
 */
function authed<Env extends { Variables: { keyUserId: string } }>(
  handler: (c: import("hono").Context<Env>) => Promise<Response> | Response,
) {
  return async (c: import("hono").Context<Env>) => {
    const userId = await authorise(c.req.header("authorization"));
    if (!userId) {
      return c.json(error("Invalid or missing API key", "invalid_request_error"), 401);
    }
    c.set("keyUserId", userId);
    return handler(c);
  };
}

function error(message: string, type: string) {
  return { error: { message, type, param: null, code: null } };
}

openai.get("/v1/models", authed(async (c) => {
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
}));

openai.post("/v1/chat/completions", authed(async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = chatBody.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      error(
        parsed.error.issues[0]?.message ?? "Invalid request body",
        "invalid_request_error",
      ),
      400,
    );
  }
  // `parsed.data` is fully narrowed, so `model` and `messages` are known good.
  const body = parsed.data;

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
        error(e instanceof Error ? e.message : String(e), "upstream_error"),
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
}));

/** What a client can expect, mirroring the gateway's advertised surface. */
/** Unauthenticated on purpose: it advertises paths and nothing secret. */
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
