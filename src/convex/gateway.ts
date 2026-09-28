// The self-hosted server panel: the upstream account pool, usage accounting,
// guardrail findings, and the API keys friends use to hit the gateway directly.

import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { AGENTS, MODELS } from "../lib/catalog";
import type {
  FindingsResult,
  PoolResult,
  PoolSummary,
  UsageStats,
} from "./apiKeyAuth";

const HEALTH_WINDOW = 100;

/** Idempotent. Called by the client on mount so a cold deploy is never empty. */
export const bootstrap = mutation({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.agentRuntime.ensureSeeded, {});
    return { ok: true };
  },
});

export const pool = query({
  args: {},
  handler: async (ctx): Promise<PoolResult> => {
    const now = Date.now();
    const accounts = await ctx.db.query("gatewayAccounts").collect();
    return accounts
      .map((a) => ({
        _id: a._id,
        label: a.label,
        tier: a.tier,
        // A cooling account reads as cooling until the cooldown lapses, even if
        // the stored status has not been rewritten yet.
        status:
          a.cooldownUntil !== undefined && a.cooldownUntil > now
            ? ("cooling" as const)
            : a.status,
        health: a.health,
        inFlight: a.inFlight,
        maxSlots: a.maxSlots,
        successes: a.successes,
        failures: a.failures,
        cooldownUntil: a.cooldownUntil,
        lastUsedAt: a.lastUsedAt,
        // Free tier gets 1 slot and 3 concurrent, pro gets 3 and 8, matching
        // the upstream shape the gateway is modelling.
        concurrency: a.tier === "free" ? 3 : 8,
      }))
      .sort((a, b) => b.health - a.health);
  },
});

export const poolSummary = query({
  args: {},
  handler: async (ctx): Promise<PoolSummary> => {
    const now = Date.now();
    const accounts = await ctx.db.query("gatewayAccounts").collect();
    const healthy = accounts.filter(
      (a) => a.status !== "disabled" &&
        (a.cooldownUntil === undefined || a.cooldownUntil <= now),
    );
    return {
      total: accounts.length,
      healthy: healthy.length,
      freeSlots: healthy.reduce(
        (sum, a) => sum + Math.max(0, a.maxSlots - a.inFlight),
        0,
      ),
      totalSlots: accounts.reduce((sum, a) => sum + a.maxSlots, 0),
      avgHealth: accounts.length
        ? Math.round(
            accounts.reduce((sum, a) => sum + a.health, 0) / accounts.length,
          )
        : 0,
    };
  },
});

export const addAccount = mutation({
  args: { label: v.string(), tier: v.union(v.literal("free"), v.literal("pro")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in.");

    const label = args.label.trim();
    if (!label) throw new Error("Label is required.");
    const dupe = await ctx.db
      .query("gatewayAccounts")
      .filter((q) => q.eq(q.field("label"), label))
      .first();
    if (dupe) throw new Error("That account label already exists.");

    return await ctx.db.insert("gatewayAccounts", {
      label,
      tier: args.tier,
      status: "healthy",
      health: HEALTH_WINDOW,
      inFlight: 0,
      maxSlots: args.tier === "free" ? 1 : 3,
      successes: 0,
      failures: 0,
      createdAt: Date.now(),
    });
  },
});

export const setAccountStatus = mutation({
  args: {
    accountId: v.id("gatewayAccounts"),
    status: v.union(
      v.literal("healthy"),
      v.literal("degraded"),
      v.literal("disabled"),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in.");

    const account = await ctx.db.get(args.accountId);
    if (!account) throw new Error("Account not found.");

    await ctx.db.patch(account._id, {
      status: args.status,
      // Bringing a disabled account back clears its cooldown.
      cooldownUntil: args.status === "disabled" ? undefined : account.cooldownUntil,
      health: args.status === "healthy" ? HEALTH_WINDOW : account.health,
    });
    return null;
  },
});

export const removeAccount = mutation({
  args: { accountId: v.id("gatewayAccounts") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in.");
    await ctx.db.delete(args.accountId);
    return null;
  },
});

export const usage = query({
  args: {},
  handler: async (ctx): Promise<UsageStats> => {
    const events = await ctx.db
      .query("usageEvents")
      .withIndex("by_created")
      .collect();
    const recent = events.slice(-100);

    const perModel = new Map<string, number>();
    const perAccount = new Map<string, { ok: number; failed: number }>();
    let tokensIn = 0;
    let tokensOut = 0;
    let failed = 0;
    let latencySum = 0;
    let latencyCount = 0;

    for (const e of events) {
      tokensIn += e.tokensIn;
      tokensOut += e.tokensOut;
      if (!e.ok) failed++;
      else {
        latencySum += e.latencyMs;
        latencyCount++;
      }
      perModel.set(e.model, (perModel.get(e.model) ?? 0) + 1);
      const bucket = perAccount.get(e.accountLabel) ?? { ok: 0, failed: 0 };
      if (e.ok) bucket.ok++;
      else bucket.failed++;
      perAccount.set(e.accountLabel, bucket);
    }

    return {
      requests: events.length,
      tokensIn,
      tokensOut,
      failed,
      avgLatencyMs: latencyCount ? Math.round(latencySum / latencyCount) : 0,
      perModel: [...perModel.entries()]
        .map(([model, count]) => ({ model, count }))
        .sort((a, b) => b.count - a.count),
      perAccount: [...perAccount.entries()].map(([label, b]) => ({
        label,
        ...b,
      })),
      recent: recent
        .slice(-12)
        .reverse()
        .map((e) => ({
          accountLabel: e.accountLabel,
          model: e.model,
          agent: e.agent,
          latencyMs: e.latencyMs,
          tokensIn: e.tokensIn,
          tokensOut: e.tokensOut,
          ok: e.ok,
          createdAt: e.createdAt,
        })),
    };
  },
});

export const guardrailFindings = query({
  args: {},
  handler: async (ctx): Promise<FindingsResult> => {
    const userId = await getAuthUserId(ctx);
    const rows = userId
      ? await ctx.db
          .query("guardrailHits")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect()
      : await ctx.db.query("guardrailHits").collect();

    const byCategory = new Map<string, number>();
    for (const r of rows) {
      byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
    }

    return {
      total: rows.length,
      byCategory: [...byCategory.entries()].map(([category, count]) => ({
        category,
        count,
      })),
      recent: rows
        .slice(-15)
        .reverse()
        .map((r) => ({
          _id: r._id,
          category: r.category,
          severity: r.severity,
          reason: r.reason,
          createdAt: r.createdAt,
        })),
    };
  },
});

function makeKey() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `sk-lolo-${out}`;
}

export const listApiKeys = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    return await ctx.db
      .query("apiKeys")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
  },
});

export const createApiKey = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in.");

    const secret = makeKey();
    const id = await ctx.db.insert("apiKeys", {
      ownerId: userId,
      name: args.name.trim() || "Untitled key",
      prefix: secret.slice(0, 14),
      secret,
      revoked: false,
      createdAt: Date.now(),
    });
    // The raw key is returned exactly once, at creation.
    return { id, secret };
  },
});

export const revokeApiKey = mutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in.");

    const key = await ctx.db.get(args.keyId);
    if (!key || key.ownerId !== userId) throw new Error("Key not found.");
    await ctx.db.patch(key._id, { revoked: true });
    return null;
  },
});

/** Static catalog the panel and the landing page both read from. */
export const catalog = query({
  args: {},
  handler: () => ({ agents: AGENTS, models: MODELS }),
});
