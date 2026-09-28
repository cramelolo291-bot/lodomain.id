// The public face of the self-hosted gateway: OpenAI-shaped HTTP that any
// OpenAI client can point at, plus the key check that guards it.
//
// The web app uses the in-app path; this is what a friend wires into their
// own editor so they get the same Lolo pool.

import { action, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { AGENTS, getAgent, getModel, MODELS } from "../lib/catalog";
import type {
  CompleteResult,
  HealthResult,
  ModelsResult,
} from "./apiKeyAuth";

/** Backs `GET /v1/models`. */
export const modelsForKey = query({
  args: { secret: v.optional(v.string()) },
  handler: async (ctx, args): Promise<ModelsResult> => {
    const check = await ctx.runQuery(internal.apiKeyAuth.resolveKey, {
      secret: args.secret,
    });
    if (!check.ok) {
      return { ok: false as const, status: check.status, error: check.error };
    }
    return {
      ok: true,
      data: MODELS.map((m) => ({
        id: m.id,
        object: "model",
        owned_by: "lolo-gateway",
        context_window: m.contextK * 1024,
      })),
    };
  },
});

/** Backs `GET /healthz`. No key required — a health probe should be open. */
export const health = query({
  args: {},
  handler: async (ctx): Promise<HealthResult> => {
    const now = Date.now();
    const accounts = await ctx.db.query("gatewayAccounts").collect();
    const usable = accounts.filter(
      (a) =>
        a.status !== "disabled" &&
        (a.cooldownUntil === undefined || a.cooldownUntil <= now),
    );
    return {
      status: usable.length > 0 ? "ok" : "degraded",
      accounts: accounts.length,
      usableAccounts: usable.length,
      freeSlots: usable.reduce(
        (sum, a) => sum + Math.max(0, a.maxSlots - a.inFlight),
        0,
      ),
      version: "1.0.0",
    };
  },
});

/** Backs `POST /v1/chat/completions`. */
export const complete = action({
  args: {
    secret: v.optional(v.string()),
    model: v.string(),
    messages: v.array(
      v.object({
        role: v.string(),
        content: v.string(),
      }),
    ),
    stream: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<CompleteResult> => {
    const check = await ctx.runQuery(internal.apiKeyAuth.resolveKey, {
      secret: args.secret,
    });
    if (!check.ok) {
      return { ok: false, status: check.status, error: check.error };
    }

    await ctx.runMutation(internal.agentRuntime.ensureSeeded, {});

    const model = getModel(args.model);
    // The caller picks the agent by naming it in the system message, e.g.
    // "builder: ship the migration". Anything else gets the orchestrator.
    const systemTurn = args.messages.find((m) => m.role === "system");
    const named = systemTurn?.content.split(":")[0]?.trim() ?? "";
    const agent = AGENTS.some((a) => a.key === named)
      ? getAgent(named)
      : getAgent("lolo");

    const lastUser = [...args.messages]
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUser) {
      return {
        ok: false,
        status: 400,
        error: "No user message in the request.",
      };
    }

    const url = process.env.LOLO_GATEWAY_URL ?? "https://api.groq.com/openai/v1";
    const key = process.env.LOLO_GATEWAY_KEY ?? "";

    const claimed = await ctx.runMutation(internal.agentRuntime.claimAccount, {});
    if (!claimed) {
      return {
        ok: false,
        status: 429,
        error: "No free slot in the pool. Retry shortly.",
      };
    }

    const account = await ctx.runQuery(internal.agentRuntime.accountLabel, {
      accountId: claimed,
    });
    const accountLabel = account?.label ?? "pool";

    // Without an upstream credential the gateway answers 503 rather than
    // pretending — an OpenAI client can distinguish that from a real reply.
    if (!key) {
      await ctx.runMutation(internal.agentRuntime.settleAccount, {
        accountId: claimed,
        ok: true,
        latencyMs: 0,
      });
      return {
        ok: false,
        status: 503,
        error:
          "Gateway has no upstream credential. Set LOLO_GATEWAY_KEY on the server.",
      };
    }

    const started = Date.now();
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: model.id,
          stream: false,
          messages: [
            { role: "system", content: agent.systemPrompt },
            ...args.messages.filter((m) => m.role !== "system"),
          ],
        }),
      });

      if (!res.ok) {
        throw new Error(
          `upstream ${res.status}: ${(await res.text()).slice(0, 200)}`,
        );
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = json.choices?.[0]?.message?.content ?? "";
      const latency = Date.now() - started;
      const tokensIn = json.usage?.prompt_tokens ?? 0;
      const tokensOut = json.usage?.completion_tokens ?? 0;

      await ctx.runMutation(internal.agentRuntime.settleAccount, {
        accountId: claimed,
        ok: true,
        latencyMs: latency,
      });
      await ctx.runMutation(internal.agentRuntime.recordUsage, {
        accountLabel,
        model: model.id,
        agent: agent.key,
        tokensIn,
        tokensOut,
        latencyMs: latency,
        ok: true,
      });

      return {
        ok: true,
        response: {
          id: `chatcmpl-lolo-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: model.id,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: tokensIn,
            completion_tokens: tokensOut,
            total_tokens: tokensIn + tokensOut,
          },
        },
      };
    } catch (error) {
      const latency = Date.now() - started;
      await ctx.runMutation(internal.agentRuntime.settleAccount, {
        accountId: claimed,
        ok: false,
        latencyMs: latency,
      });
      await ctx.runMutation(internal.agentRuntime.recordUsage, {
        accountLabel,
        model: model.id,
        agent: agent.key,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: latency,
        ok: false,
      });
      return {
        ok: false,
        status: 502,
        error: error instanceof Error ? error.message : "Upstream failure.",
      };
    }
  },
});
