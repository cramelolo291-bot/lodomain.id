// Conversation + message reads and writes for the Lolo AI workspace.

import { mutation, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { DEFAULT_MODEL, getAgent } from "../lib/catalog";

async function requireUser(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in.");
  return userId;
}

export const listConversations = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .collect();

    return rows
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => ({
        _id: c._id,
        title: c.title,
        agent: c.agent,
        model: c.model,
        updatedAt: c.updatedAt,
      }));
  },
});

export const createConversation = mutation({
  args: {
    agent: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    return await ctx.db.insert("conversations", {
      userId,
      title: "New run",
      agent: args.agent ?? getAgent("lolo").key,
      model: args.model ?? DEFAULT_MODEL,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateConversation = mutation({
  args: {
    conversationId: v.id("conversations"),
    agent: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new Error("Not your conversation.");
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.agent) patch.agent = args.agent;
    if (args.model) patch.model = args.model;
    await ctx.db.patch(args.conversationId, patch);
    return null;
  },
});

export const deleteConversation = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new Error("Not your conversation.");
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .collect();
    for (const m of messages) await ctx.db.delete(m._id);
    await ctx.db.delete(args.conversationId);
    return null;
  },
});

export const listMessages = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new Error("Not your conversation.");
    }

    return await ctx.db
      .query("messages")
      .withIndex("by_conversation_created", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .collect();
  },
});

/** Seeded on first read so the workspace is never empty on a cold deploy. */
export const listAgents = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("agents").collect();
    return rows.sort((a, b) => a.order - b.order);
  },
});
