import {
  httpRouter,
  type HttpActionContext,
} from "convex/server";
import { auth } from "./auth";
import { api } from "./_generated/api";
import { MODELS } from "../lib/catalog";

const http = httpRouter();

auth.addHttpRoutes(http);

/** Strips a `Bearer ` prefix from an Authorization header. */
function bearer(headers: Headers): string | undefined {
  const raw = headers.get("authorization") ?? headers.get("x-api-key") ?? "";
  return raw.replace(/^Bearer\s+/i, "").trim() || undefined;
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error: { message: error } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

// ── OpenAI-compatible surface ─────────────────────────────────────────────
// Point any OpenAI client at <convex-site>/v1 and it just works.

http.route({
  path: "/v1/models",
  method: "GET",
  handler: async (ctx: HttpActionContext): Promise<Response> => {
    const result = await ctx.runQuery(api.compat.modelsForKey, {
      secret: bearer(ctx.request.headers),
    });
    if (!result.ok) return jsonError(result.status, result.error);
    return jsonOk({ object: "list", data: result.data });
  },
});

http.route({
  path: "/v1/chat/completions",
  method: "POST",
  handler: async (ctx: HttpActionContext): Promise<Response> => {
    let body: {
      model?: string;
      messages?: Array<{ role: string; content: string }>;
      stream?: boolean;
    };
    try {
      body = await ctx.request.json();
    } catch {
      return jsonError(400, "Request body must be JSON.");
    }

    if (!body.model || !Array.isArray(body.messages)) {
      return jsonError(400, "`model` and `messages` are required.");
    }
    if (body.stream) {
      return jsonError(400, "Streaming is not supported in v1. Send stream: false.");
    }

    const result = await ctx.runAction(api.compat.complete, {
      secret: bearer(ctx.request.headers),
      model: body.model,
      messages: body.messages,
      stream: false,
    });
    if (!result.ok) return jsonError(result.status, result.error);
    return jsonOk(result.response);
  },
});

// ── Operations ────────────────────────────────────────────────────────────

http.route({
  path: "/healthz",
  method: "GET",
  handler: async (ctx: HttpActionContext): Promise<Response> => {
    return jsonOk(await ctx.runQuery(api.compat.health, {}));
  },
});

/** Free-tier balance and per-model remaining, the way the pool reports it. */
http.route({
  path: "/api/account/balance",
  method: "GET",
  handler: async (ctx: HttpActionContext): Promise<Response> => {
    const [summary, pool] = await Promise.all([
      ctx.runQuery(api.gateway.poolSummary, {}),
      ctx.runQuery(api.gateway.pool, {}),
    ]);
    return jsonOk({
      ...summary,
      accounts: pool.map((a) => ({
        label: a.label,
        tier: a.tier,
        status: a.status,
        health: a.health,
        slots: `${a.inFlight}/${a.maxSlots}`,
        concurrency: a.concurrency,
      })),
      catalog: MODELS.map((m) => m.id),
    });
  },
});

http.route({
  path: "/api/usage",
  method: "GET",
  handler: async (ctx: HttpActionContext): Promise<Response> => {
    return jsonOk(await ctx.runQuery(api.gateway.usage, {}));
  },
});

export default http;
