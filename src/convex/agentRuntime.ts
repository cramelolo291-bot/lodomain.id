// Internal mutations the agent action drives. Nothing here is callable from the
// browser — the action is the only writer, so the gateway pool can never be
// mutated by a client.

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type Doc,
  type Id,
} from "./_generated/server";
import { AGENTS } from "../lib/catalog";

const COOLDOWN_MS = 30_000;
const MAX_CONTEXT = 20;

/** Create the specialist agent catalog. Idempotent. */
export const seedAgents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("agents")
      .collect();
    if (existing.length >= AGENTS.length) return { seeded: 0 };

    for (const agent of AGENTS) {
      const dupe = await ctx.db
        .query("agents")
        .filter((q) => q.eq(q.field("key"), agent.key))
        .first();
      if (dupe) continue;
      await ctx.db.insert("agents", agent);
    }
    return { seeded: AGENTS.length };
  },
});

/**
 * Seed a starter upstream pool. A self-hosted gateway starts with a couple of
 * free-tier accounts; pro accounts get added later from the server panel.
 */
export const seedGatewayPool = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("gatewayAccounts").collect();
    if (existing.length > 0) return { seeded: 0 };

    const now = Date.now();
    const starters: Array<{
      label: string;
      tier: "free" | "pro";
      health: number;
      maxSlots: number;
    }> = [
      { label: "free-primary", tier: "free", health: 92, maxSlots: 1 },
      { label: "free-secondary", tier: "free", health: 74, maxSlots: 1 },
      { label: "pro-backup", tier: "pro", health: 88, maxSlots: 3 },
    ];

    for (const s of starters) {
      await ctx.db.insert("gatewayAccounts", {
        label: s.label,
        tier: s.tier,
        status: "healthy",
        health: s.health,
        inFlight: 0,
        maxSlots: s.maxSlots,
        successes: 0,
        failures: 0,
        createdAt: now,
      });
    }
    return { seeded: starters.length };
  },
});

/** Ensure agents + pool exist before anything reads them. */
export const ensureSeeded = internalMutation({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db.query("agents").collect();
    if (agents.length < AGENTS.length) {
      for (const agent of AGENTS) {
        const dupe = await ctx.db
          .query("agents")
          .filter((q) => q.eq(q.field("key"), agent.key))
          .first();
        if (dupe) continue;
        await ctx.db.insert("agents", agent);
      }
    }

    const accounts = await ctx.db.query("gatewayAccounts").collect();
    if (accounts.length === 0) {
      const now = Date.now();
      const starters = [
        { label: "free-primary", tier: "free" as const, health: 92, maxSlots: 1 },
        { label: "free-secondary", tier: "free" as const, health: 74, maxSlots: 1 },
        { label: "pro-backup", tier: "pro" as const, health: 88, maxSlots: 3 },
      ];
      for (const s of starters) {
        await ctx.db.insert("gatewayAccounts", {
          label: s.label,
          tier: s.tier,
          status: "healthy",
          health: s.health,
          inFlight: 0,
          maxSlots: s.maxSlots,
          successes: 0,
          failures: 0,
          createdAt: now,
        });
      }
    }
    return { ok: true };
  },
});

/**
 * Pick the healthiest account that is not cooling down and still has a free
 * slot, and hold that slot for the duration of the upstream call.
 */
export const claimAccount = internalMutation({
  args: { exclude: v.optional(v.array(v.id("gatewayAccounts"))) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const accounts = await ctx.db.query("gatewayAccounts").collect();
    const excluded = new Set((args.exclude ?? []).map(String));

    const candidates = accounts
      .filter(
        (a) =>
          !excluded.has(String(a._id)) &&
          a.status !== "disabled" &&
          a.inFlight < a.maxSlots &&
          (a.cooldownUntil === undefined || a.cooldownUntil <= now),
      )
      // Healthy first, then the widest free slot, then highest health.
      .sort((a, b) => {
        if (b.health !== a.health) return b.health - a.health;
        return a.maxSlots - b.maxSlots;
      });

    const picked = candidates[0];
    if (!picked) return null;

    await ctx.db.patch(picked._id, { inFlight: picked.inFlight + 1 });
    return picked._id;
  },
});

/** Release a held slot and fold the outcome back into the account's health. */
export const settleAccount = internalMutation({
  args: {
    accountId: v.id("gatewayAccounts"),
    ok: v.boolean(),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) return;

    const now = Date.now();
    const inFlight = Math.max(0, account.inFlight - 1);

    if (args.ok) {
      // Slow replies nudge health down; clean calls nudge it up, capped at 100.
      const speedPenalty = args.latencyMs > 20_000 ? 4 : 0;
      const health = Math.min(100, account.health + 1 - speedPenalty);
      await ctx.db.patch(account._id, {
        inFlight,
        health,
        status: health < 40 ? "degraded" : "healthy",
        cooldownUntil: undefined,
        successes: account.successes + 1,
        lastUsedAt: now,
      });
      return;
    }

    const health = Math.max(0, account.health - 15);
    await ctx.db.patch(account._id, {
      inFlight,
      health,
      failures: account.failures + 1,
      status: health <= 0 ? "disabled" : "cooling",
      cooldownUntil: now + COOLDOWN_MS,
      lastUsedAt: now,
    });
  },
});

/** Ownership check used by the turn action before it reads or writes anything. */
export const conversationOwner = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) return null;
    return { userId: conversation.userId, model: conversation.model };
  },
});

export const accountLabel = internalQuery({
  args: { accountId: v.id("gatewayAccounts") },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    return account ? { label: account.label } : null;
  },
});

/** Everything the action needs to build an upstream request. */
export const loadContext = internalMutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) return null;

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_created", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .collect();

    return {
      conversation,
      // Only the tail of the thread is sent upstream; the rest stays in the DB.
      history: messages
        .filter((m) => !m.blocked)
        .slice(-MAX_CONTEXT)
        .map((m) => ({ role: m.role, content: m.content })),
    };
  },
});

export const appendMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    agent: v.optional(v.string()),
    model: v.optional(v.string()),
    blocked: v.optional(v.boolean()),
    guardrail: v.optional(
      v.union(
        v.literal("prompt_injection"),
        v.literal("jailbreak"),
        v.literal("pii_leakage"),
        v.literal("system_prompt_leak"),
        v.literal("excessive_agency"),
        v.literal("shell_injection"),
        v.literal("credential_access"),
      ),
    ),
    guardrailReason: v.optional(v.string()),
    latencyMs: v.optional(v.number()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("messages", { ...args, createdAt: now });
    await ctx.db.patch(args.conversationId, { updatedAt: now });

    // First user message names the thread.
    const conversation = await ctx.db.get(args.conversationId);
    if (
      conversation &&
      conversation.title === "New run" &&
      args.role === "user"
    ) {
      await ctx.db.patch(args.conversationId, {
        title: args.content.slice(0, 60) || "New run",
      });
    }
    return id;
  },
});

export const recordUsage = internalMutation({
  args: {
    accountLabel: v.string(),
    model: v.string(),
    agent: v.string(),
    tokensIn: v.number(),
    tokensOut: v.number(),
    latencyMs: v.number(),
    ok: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("usageEvents", { ...args, createdAt: Date.now() });
  },
});

export const recordGuardrailHit = internalMutation({
  args: {
    userId: v.id("users"),
    conversationId: v.optional(v.id("conversations")),
    category: v.string(),
    severity: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("guardrailHits", {
      userId: args.userId,
      conversationId: args.conversationId,
      category: args.category as Doc<"guardrailHits">["category"],
      severity: args.severity as Doc<"guardrailHits">["severity"],
      reason: args.reason,
      createdAt: Date.now(),
    });
  },
});
