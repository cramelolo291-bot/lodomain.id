// Server-sent events for a turn.
//
// Same pipeline as `POST /api/turn` — `streamTurn` is the single implementation,
// and this route is just a different way of reading its events. That matters:
// there is no second code path to keep in sync.
//
// Protocol (text/event-stream, `data:` lines only, so a simple client can read
// it without an EventSource polyfill):
//
//   {"type":"step","step":{"stage":"guardrail","detail":"clean","ms":1}}
//   {"type":"delta","text":"Here's"}
//   {"type":"table","name":"products","rows":3}
//   {"type":"done","result":{ ... }}
//
// `done` is always the last event, including on failure, so a client never has
// to guess whether the turn is still running.

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { requireAuth } from "../auth/session";
import { db } from "../db/client";
import { conversations, projects } from "../db/schema";
import { streamTurn, type TurnEvent } from "../pipeline/run-turn";
import { rateLimit } from "../http/rate-limit";
import { body as parseBody, turnBody } from "../http/validate";

export const turnStream = new Hono();

turnStream.post("/api/turn/stream", rateLimit({ limit: 60, windowMs: 60_000, scope: "turn" }), requireAuth, async (c) => {
  const { userId } = c.get("session");
  const input = await parseBody(c, turnBody);

  const owned = await db
    .select({ id: conversations.id, projectId: conversations.projectId })
    .from(conversations)
    .where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, userId)))
    .limit(1);

  const conversation = owned[0];
  if (!conversation) {
    // Same reasoning as the non-streaming route: confirming it exists would
    // leak that it exists at all.
    return c.json({ error: { message: "Not found" } }, 404);
  }

  const project = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, conversation.projectId))
    .limit(1);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = (event: TurnEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // A client that navigates away aborts the fetch; without this the model
      // keeps generating and the slot stays claimed.
      const onAbort = () => {
        closed = true;
        controller.close();
      };
      c.req.raw.signal.addEventListener("abort", onAbort);

      try {
        await streamTurn(
          {
            conversationId: conversation.id,
            projectId: project[0]?.id ?? conversation.projectId,
            userId,
            prompt: input.prompt,
            agent: input.agent,
            model: input.model,
            effort: input.effort,
            localModel: input.localModel,
            stream: true,
          },
          send,
        );
      } catch (e) {
        send({
          type: "done",
          result: {
            status: "error",
            reason: e instanceof Error ? e.message : String(e),
          },
        });
      } finally {
        c.req.raw.signal.removeEventListener("abort", onAbort);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx buffers SSE into one lump unless told not to.
      "x-accel-buffering": "no",
    },
  });
});
