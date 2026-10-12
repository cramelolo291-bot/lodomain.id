// The whole of Lolo AI's persistence, in one file.
//
// Nothing else in the server is allowed to know SQL. Everything goes through
// Drizzle so a migration is the only time a schema change can break something.
//
// Design rules baked in here:
//   - no secret is ever stored raw (sessions, magic links, API keys are hashed)
//   - every mutable row carries created_at/updated_at so ordering is stable
//   - project data is a real table (`project_rows`), not a JSON blob, so the
//     workspace SQL console means something

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["admin", "user"]);
export const accountStatusEnum = pgEnum("account_status", [
  "healthy",
  "degraded",
  "cooling",
  "disabled",
]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);
export const severityEnum = pgEnum("severity", [
  "low",
  "medium",
  "high",
  "critical",
]);
export const directionEnum = pgEnum("direction", ["input", "output"]);
export const columnTypeEnum = pgEnum("column_type", [
  "text",
  "number",
  "bool",
  "date",
]);

const id = () =>
  uuid("id")
    .primaryKey()
    .defaultRandom();

// ── Identity ───────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    role: roleEnum("role").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(sql`lower(${t.email})`)],
);

/** Only the hash is stored. The raw token exists once, in the Set-Cookie. */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_token_idx").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

/** Single-use. `usedAt` is what makes replay impossible. */
export const magicLinks = pgTable(
  "magic_links",
  {
    id: id(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("magic_links_token_idx").on(t.tokenHash),
    index("magic_links_email_idx").on(t.email),
  ],
);

/** Per-user module settings; provider credentials are intentionally excluded. */
export const moduleConnections = pgTable(
  "module_connections",
  {
    id: id(),
    ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    moduleKey: text("module_key").notNull(),
    displayName: text("display_name").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    status: text("status").notNull().default("not_configured"),
    endpointUrl: text("endpoint_url"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("module_connections_owner_key_unique").on(t.ownerId, t.moduleKey),
    index("module_connections_owner_idx").on(t.ownerId, t.updatedAt),
  ],
);

// ── Conversation ───────────────────────────────────────────────────────────

export const projects = pgTable(
  "projects",
  {
    id: id(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("projects_owner_idx").on(t.ownerId)],
);

export const projectFiles = pgTable(
  "project_files",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.path] })],
);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New run"),
    agent: text("agent").notNull().default("lolo"),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("conversations_project_idx").on(t.projectId, t.updatedAt),
    index("conversations_user_idx").on(t.userId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    agent: text("agent"),
    model: text("model"),
    blocked: boolean("blocked").notNull().default(false),
    guardrail: text("guardrail"),
    guardrailReason: text("guardrail_reason"),
    latencyMs: integer("latency_ms"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

// ── Model pool ─────────────────────────────────────────────────────────────

/**
 * One row per upstream endpoint. `inFlight` and `health` are what the
 * scheduler reads on every request, so both are indexed-adjacent integers
 * rather than derived values.
 */
export const poolAccounts = pgTable(
  "pool_accounts",
  {
    id: id(),
    label: text("label").notNull(),
    tier: text("tier").notNull(),
    status: accountStatusEnum("status").notNull().default("healthy"),
    health: integer("health").notNull().default(100),
    inFlight: integer("in_flight").notNull().default(0),
    maxSlots: integer("max_slots").notNull(),
    concurrency: integer("concurrency").notNull(),
    successes: integer("successes").notNull().default(0),
    failures: integer("failures").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("pool_accounts_label_idx").on(t.label),
    index("pool_accounts_status_idx").on(t.status, t.health),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    accountId: uuid("account_id").references(() => poolAccounts.id, {
      onDelete: "set null",
    }),
    model: text("model").notNull(),
    agent: text("agent").notNull(),
    effort: text("effort"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    ok: boolean("ok").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("usage_events_created_idx").on(t.createdAt),
    index("usage_events_model_idx").on(t.model),
  ],
);

// ── Observability ──────────────────────────────────────────────────────────

/**
 * Every turn produces one trace. The steps array is the answer to "why did it
 * say that" — guardrail, pool claim, generate — with the timing of each.
 */
export const traces = pgTable(
  "traces",
  {
    id: id(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    prompt: text("prompt").notNull(),
    agent: text("agent").notNull(),
    model: text("model").notNull(),
    account: text("account"),
    ok: boolean("ok").notNull().default(true),
    totalMs: integer("total_ms").notNull().default(0),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    steps: jsonb("steps").$type<TraceStep[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("traces_created_idx").on(t.createdAt)],
);

export type TraceStep = {
  stage: string;
  detail: string;
  ms: number;
  status: "ok" | "warn" | "error";
};

export const guardrailHits = pgTable(
  "guardrail_hits",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    category: text("category").notNull(),
    severity: severityEnum("severity").notNull(),
    direction: directionEnum("direction").notNull(),
    match: text("match").notNull(),
    excerpt: text("excerpt").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("guardrail_hits_created_idx").on(t.createdAt)],
);

// ── Credentials ────────────────────────────────────────────────────────────

/**
 * `secretHash` is a SHA-256 of the key. The plaintext is returned exactly once
 * at creation and is never recoverable afterwards.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    secretHash: text("secret_hash").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("api_keys_secret_idx").on(t.secretHash),
    index("api_keys_user_idx").on(t.userId),
  ],
);

// ── Per-project data space ─────────────────────────────────────────────────

/**
 * Real tables, so the workspace SQL console is honest. A row here is one
 * cell value; `position` preserves column order per table.
 */
export const projectTables = pgTable(
  "project_tables",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("project_tables_name_idx").on(t.projectId, t.name)],
);

export const projectColumns = pgTable(
  "project_columns",
  {
    tableId: uuid("table_id")
      .notNull()
      .references(() => projectTables.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: columnTypeEnum("type").notNull().default("text"),
    isPk: boolean("is_pk").notNull().default(false),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tableId, t.name] })],
);

export const projectRows = pgTable(
  "project_rows",
  {
    id: uuid("id")
      .primaryKey()
      .defaultRandom(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => projectTables.id, { onDelete: "cascade" }),
    /** Column name → value. Typed per `project_columns.type`. */
    data: jsonb("data").$type<Record<string, string | number | boolean | null>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("project_rows_table_idx").on(t.tableId, t.createdAt)],
);

// ── Relations ──────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  projects: many(projects),
  apiKeys: many(apiKeys),
  moduleConnections: many(moduleConnections),
}));

export const moduleConnectionsRelations = relations(moduleConnections, ({ one }) => ({
  owner: one(users, { fields: [moduleConnections.ownerId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, { fields: [projects.ownerId], references: [users.id] }),
  conversations: many(conversations),
  tables: many(projectTables),
  files: many(projectFiles),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  project: one(projects, { fields: [conversations.projectId], references: [projects.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const projectTablesRelations = relations(projectTables, ({ one, many }) => ({
  project: one(projects, { fields: [projectTables.projectId], references: [projects.id] }),
  columns: many(projectColumns),
  rows: many(projectRows),
}));

export const projectColumnsRelations = relations(projectColumns, ({ one }) => ({
  table: one(projectTables, {
    fields: [projectColumns.tableId],
    references: [projectTables.id],
  }),
}));

export const projectRowsRelations = relations(projectRows, ({ one }) => ({
  table: one(projectTables, {
    fields: [projectRows.tableId],
    references: [projectTables.id],
  }),
}));

export const schema = {
  users,
  sessions,
  magicLinks,
  projects,
  conversations,
  messages,
  poolAccounts,
  usageEvents,
  traces,
  guardrailHits,
  apiKeys,
  moduleConnections,
  projectTables,
  projectColumns,
  projectRows,
  projectFiles,
};
