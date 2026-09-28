// Bearer-key resolution for the public gateway.
//
// Kept in its own file: `compat.ts` queries call this, and an internal query
// that lived alongside its callers would make the module self-referential,
// which defeats TypeScript's inference over the Convex function registry.

import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * Result shapes for the gateway API, declared here rather than inline.
 *
 * A Convex module that both exports functions and reaches for `internal` makes
 * the `internal` namespace reference its own exports, and TypeScript cannot
 * infer the return types across that cycle. Naming the results breaks it.
 */

export type KeyCheck =
  | { ok: true; ownerId: string }
  | { ok: false; status: number; error: string };

export type ModelsResult =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      data: Array<{
        id: string;
        object: string;
        owned_by: string;
        context_window: number;
      }>;
    };

export type OpenAICompletion = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type CompleteResult =
  | { ok: false; status: number; error: string }
  | { ok: true; response: OpenAICompletion };

export type HealthResult = {
  status: "ok" | "degraded";
  accounts: number;
  usableAccounts: number;
  freeSlots: number;
  version: string;
};

export type PoolAccount = {
  _id: string;
  label: string;
  tier: "free" | "pro";
  status: "healthy" | "degraded" | "cooling" | "disabled";
  health: number;
  inFlight: number;
  maxSlots: number;
  successes: number;
  failures: number;
  cooldownUntil?: number;
  lastUsedAt?: number;
  concurrency: number;
};

export type PoolResult = PoolAccount[];

export type PoolSummary = {
  total: number;
  healthy: number;
  freeSlots: number;
  totalSlots: number;
  avgHealth: number;
};

export type UsageStats = {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  failed: number;
  avgLatencyMs: number;
  perModel: Array<{ model: string; count: number }>;
  perAccount: Array<{ label: string; ok: number; failed: number }>;
  recent: Array<{
    accountLabel: string;
    model: string;
    agent: string;
    latencyMs: number;
    tokensIn: number;
    tokensOut: number;
    ok: boolean;
    createdAt: number;
  }>;
};

export type FindingsResult = {
  total: number;
  byCategory: Array<{ category: string; count: number }>;
  recent: Array<{
    _id: string;
    category: string;
    severity: string;
    reason: string;
    createdAt: number;
  }>;
};

export const resolveKey = internalQuery({
  args: { secret: v.optional(v.string()) },
  handler: async (ctx, args): Promise<KeyCheck> => {
    if (!args.secret) {
      return { ok: false, status: 401, error: "Missing bearer token." };
    }

    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_secret", (q) => q.eq("secret", args.secret as string))
      .first();

    if (!key) return { ok: false, status: 401, error: "Invalid API key." };
    if (key.revoked) return { ok: false, status: 401, error: "API key revoked." };

    return { ok: true, ownerId: key.ownerId };
  },
});
