import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

/** Guardrail verdicts, in the spirit of DeepTeam's vulnerability classes. */
export const GUARDRAILS = {
  PROMPT_INJECTION: "prompt_injection",
  JAILBREAK: "jailbreak",
  PII_LEAKAGE: "pii_leakage",
  SYSTEM_PROMPT_LEAK: "system_prompt_leak",
  EXCESSIVE_AGENCY: "excessive_agency",
  SHELL_INJECTION: "shell_injection",
  CREDENTIAL_ACCESS: "credential_access",
} as const;

export const guardrailValidator = v.union(
  v.literal(GUARDRAILS.PROMPT_INJECTION),
  v.literal(GUARDRAILS.JAILBREAK),
  v.literal(GUARDRAILS.PII_LEAKAGE),
  v.literal(GUARDRAILS.SYSTEM_PROMPT_LEAK),
  v.literal(GUARDRAILS.EXCESSIVE_AGENCY),
  v.literal(GUARDRAILS.SHELL_INJECTION),
  v.literal(GUARDRAILS.CREDENTIAL_ACCESS),
);
export type Guardrail = Infer<typeof guardrailValidator>;

export const severityValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("critical"),
);
export type Severity = Infer<typeof severityValidator>;

/** Tier of an upstream account in the self-hosted gateway pool. */
export const accountTierValidator = v.union(
  v.literal("free"),
  v.literal("pro"),
);
export type AccountTier = Infer<typeof accountTierValidator>;

export const accountStatusValidator = v.union(
  v.literal("healthy"),
  v.literal("degraded"),
  v.literal("cooling"),
  v.literal("disabled"),
);
export type AccountStatus = Infer<typeof accountStatusValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // add other tables here

    // ─── Lolo AI agent system ───────────────────────────────────────────

    /** The specialist agents Lolo can dispatch to. Seeded, not user-editable in v1. */
    agents: defineTable({
      key: v.string(), // "researcher" | "builder" | "redteam" | "lolo"
      name: v.string(),
      tagline: v.string(),
      description: v.string(),
      systemPrompt: v.string(),
      accent: v.string(), // "cool" | "warm"
      order: v.number(),
    }).index("by_order", ["order"]),

    conversations: defineTable({
      userId: v.id("users"),
      title: v.string(),
      agent: v.string(), // default agent key
      model: v.string(), // upstream model id
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_updated", ["userId", "updatedAt"]),

    messages: defineTable({
      conversationId: v.id("conversations"),
      userId: v.id("users"),
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
      agent: v.optional(v.string()),
      model: v.optional(v.string()),
      /** Set when the guardrail blocked the turn before it reached a model. */
      blocked: v.optional(v.boolean()),
      guardrail: v.optional(guardrailValidator),
      guardrailReason: v.optional(v.string()),
      latencyMs: v.optional(v.number()),
      tokensIn: v.optional(v.number()),
      tokensOut: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_conversation", ["conversationId"])
      .index("by_conversation_created", ["conversationId", "createdAt"]),

    /** Upstream accounts the self-hosted gateway rotates across. */
    gatewayAccounts: defineTable({
      label: v.string(),
      tier: accountTierValidator,
      status: accountStatusValidator,
      health: v.number(), // 0..100
      cooldownUntil: v.optional(v.number()),
      inFlight: v.number(),
      maxSlots: v.number(),
      successes: v.number(),
      failures: v.number(),
      lastUsedAt: v.optional(v.number()),
      createdAt: v.number(),
    }).index("by_health", ["health"]),

    usageEvents: defineTable({
      accountLabel: v.string(),
      model: v.string(),
      agent: v.string(),
      tokensIn: v.number(),
      tokensOut: v.number(),
      latencyMs: v.number(),
      ok: v.boolean(),
      createdAt: v.number(),
    }).index("by_created", ["createdAt"]),

    /** Keys friends use to hit the gateway over plain HTTP (OpenAI-shaped). */
    apiKeys: defineTable({
      ownerId: v.id("users"),
      name: v.string(),
      prefix: v.string(),
      secret: v.string(), // stored so the raw key can be shown once on create
      revoked: v.boolean(),
      lastUsedAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_owner", ["ownerId"])
      .index("by_secret", ["secret"]),

    guardrailHits: defineTable({
      userId: v.id("users"),
      conversationId: v.optional(v.id("conversations")),
      category: guardrailValidator,
      severity: severityValidator,
      reason: v.string(),
      createdAt: v.number(),
    })
      .index("by_created", ["createdAt"])
      .index("by_user", ["userId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
