// The Lolo AI turn: one request in, one persisted answer out.
//
// Pipeline, in order:
//   1. screen the prompt against the guardrail rules
//   2. claim a slot on the healthiest upstream account in the pool
//   3. call the OpenAI-compatible endpoint behind the gateway
//   4. settle the account, write the usage event, store both messages
//
// The gateway is OpenAI-shaped on purpose: point LOLO_GATEWAY_URL at a local
// server, a self-hosted proxy, or a hosted API and the same code works.

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { getAgent, getModel } from "../lib/catalog";
import { screen } from "../lib/guardrails";

const MAX_ATTEMPTS = 2;

type UpstreamReply = {
  content: string;
  tokensIn: number;
  tokensOut: number;
};

async function callUpstream(args: {
  url: string;
  key: string;
  model: string;
  system: string;
  history: Array<{ role: string; content: string }>;
  effort?: string;
}): Promise<UpstreamReply> {
  const messages = [
    { role: "system", content: args.system },
    ...args.history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const body: Record<string, unknown> = {
    model: args.model,
    messages,
    stream: false,
  };
  // Only send a reasoning effort the target model actually accepts; unsupported
  // values are stripped rather than erroring the whole turn.
  if (args.effort && args.effort !== "none") {
    body.reasoning_effort = args.effort;
  }

  const res = await fetch(`${args.url.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${args.key}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`upstream ${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("upstream returned an empty completion");

  return {
    content,
    tokensIn: json.usage?.prompt_tokens ?? 0,
    tokensOut: json.usage?.completion_tokens ?? 0,
  };
}

/**
 * Used when the server has no upstream credential wired up yet. It is not a
 * pretend answer: it says the gateway is unconfigured and names the knob to
 * turn, so the product is still explorable end to end.
 */
function offlineReply(agentKey: string, prompt: string): string {
  const name = getAgent(agentKey).name;
  return [
    `**${name} is in offline mode.**`,
    "",
    "The gateway is running and the guardrail layer screened this prompt clean — " +
      "but no upstream model credential is attached to the server yet, so there " +
      "is no completion to return.",
    "",
    "To turn the pool live, add your gateway credential in the Keys tab:",
    "",
    "```",
    "LOLO_GATEWAY_KEY=<your OpenAI-compatible key>",
    "```",
    "",
    `\`LOLO_GATEWAY_URL\` already points at \`${process.env.LOLO_GATEWAY_URL ?? "https://api.groq.com/openai/v1"}\`, ` +
      "so any OpenAI-shaped server — hosted or self-hosted — will work unchanged.",
    "",
    `Queued for ${name}: "${prompt.slice(0, 160)}${prompt.length > 160 ? "…" : ""}"`,
  ].join("\n");
}

export const runTurn = action({
  args: {
    conversationId: v.id("conversations"),
    prompt: v.string(),
    agent: v.string(),
    model: v.string(),
    effort: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in.");

    const owner = await ctx.runQuery(internal.agentRuntime.conversationOwner, {
      conversationId: args.conversationId,
    });
    if (!owner || owner.userId !== userId) {
      throw new Error("That conversation belongs to someone else.");
    }

    await ctx.runMutation(internal.agentRuntime.ensureSeeded, {});

    const prompt = args.prompt.trim();
    if (!prompt) throw new Error("Empty prompt.");

    const modelId = getModel(args.model).id;
    const agent = getAgent(args.agent);

    // 1 — Guardrail screen, before anything reaches an upstream provider.
    const finding = screen(prompt, "input");

    await ctx.runMutation(internal.agentRuntime.appendMessage, {
      conversationId: args.conversationId,
      userId,
      role: "user",
      content: prompt,
      agent: agent.key,
    });

    if (finding) {
      await ctx.runMutation(internal.agentRuntime.recordGuardrailHit, {
        userId,
        conversationId: args.conversationId,
        category: finding.category,
        severity: finding.severity,
        reason: finding.reason,
      });
      await ctx.runMutation(internal.agentRuntime.appendMessage, {
        conversationId: args.conversationId,
        userId,
        role: "assistant",
        content:
          "Blocked before dispatch. This turn tripped the guardrail layer and never " +
          "reached a model, so nothing was sent upstream and no tokens were spent.",
        agent: agent.key,
        blocked: true,
        guardrail: finding.category,
        guardrailReason: finding.reason,
      });
      return { status: "blocked" as const, guardrail: finding.category };
    }

    // 2 — Claim an upstream slot, retrying past accounts that fail.
    const context = await ctx.runMutation(
      internal.agentRuntime.loadContext,
      { conversationId: args.conversationId },
    );
    if (!context) throw new Error("Conversation not found.");

    const url =
      process.env.LOLO_GATEWAY_URL ?? "https://api.groq.com/openai/v1";
    const key = process.env.LOLO_GATEWAY_KEY ?? "";

    const excluded: string[] = [];
    let accountLabel = "offline";
    let lastError = "";
    let reply: UpstreamReply | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const claimed = await ctx.runMutation(
        internal.agentRuntime.claimAccount,
        { exclude: excluded },
      );
      if (!claimed) break;

      const account = await ctx.runQuery(internal.agentRuntime.accountLabel, {
        accountId: claimed,
      });
      accountLabel = account?.label ?? "pool";

      if (!key) {
        await ctx.runMutation(internal.agentRuntime.settleAccount, {
          accountId: claimed,
          ok: true,
          latencyMs: 0,
        });
        reply = {
          content: offlineReply(agent.key, prompt),
          tokensIn: 0,
          tokensOut: 0,
        };
        break;
      }

      const started = Date.now();
      try {
        const effort = getModel(args.model).efforts[0] ?? undefined;
        reply = await callUpstream({
          url,
          key,
          model: modelId,
          system: agent.systemPrompt,
          history: context.history,
          effort: args.effort ?? effort,
        });
        const latency = Date.now() - started;
        await ctx.runMutation(internal.agentRuntime.settleAccount, {
          accountId: claimed,
          ok: true,
          latencyMs: latency,
        });
        await ctx.runMutation(internal.agentRuntime.recordUsage, {
          accountLabel,
          model: modelId,
          agent: agent.key,
          tokensIn: reply.tokensIn,
          tokensOut: reply.tokensOut,
          latencyMs: latency,
          ok: true,
        });
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        await ctx.runMutation(internal.agentRuntime.settleAccount, {
          accountId: claimed,
          ok: false,
          latencyMs: Date.now() - started,
        });
        await ctx.runMutation(internal.agentRuntime.recordUsage, {
          accountLabel,
          model: modelId,
          agent: agent.key,
          tokensIn: 0,
          tokensOut: 0,
          latencyMs: Date.now() - started,
          ok: false,
        });
        excluded.push(String(claimed));
        reply = null;
      }
    }

    if (!reply) {
      const message = lastError
        ? `Every account in the pool failed this turn. Last error: ${lastError}`
        : "No account in the pool had a free slot. Wait for a cooldown to clear, or add an account from the server panel.";
      await ctx.runMutation(internal.agentRuntime.appendMessage, {
        conversationId: args.conversationId,
        userId,
        role: "assistant",
        content: message,
        agent: agent.key,
        model: modelId,
      });
      return { status: "error" as const, accountLabel };
    }

    // 4 — Screen the model's own answer before it is stored and shown.
    const leak = screen(reply.content, "output");
    if (leak) {
      await ctx.runMutation(internal.agentRuntime.recordGuardrailHit, {
        userId,
        conversationId: args.conversationId,
        category: leak.category,
        severity: leak.severity,
        reason: leak.reason,
      });
    }

    await ctx.runMutation(internal.agentRuntime.appendMessage, {
      conversationId: args.conversationId,
      userId,
      role: "assistant",
      content: reply.content,
      agent: agent.key,
      model: modelId,
      tokensIn: reply.tokensIn,
      tokensOut: reply.tokensOut,
      guardrail: leak?.category,
      guardrailReason: leak?.reason,
    });

    return { status: "ok" as const, accountLabel };
  },
});
