// Request validation.
//
// Every route that reads a body or a path parameter goes through here. The
// alternative is trusting the client, which produces two failure modes that are
// both bad: a 500 from a type the code did not expect, or worse, a value that
// reaches the database looking valid but meaning something else.
//
// The validator returns the parsed value, so handlers work with a type rather
// than `unknown` and get narrowing for free.

import type { Context } from "hono";
import { z } from "zod";

export type FieldIssue = { path: string; message: string };

/** A validation failure, so the error handler can answer 400 rather than 500. */
export class ValidationError extends Error {
  status = 400;
  issues: FieldIssue[];

  constructor(issues: FieldIssue[]) {
    super("Request failed validation");
    this.name = "ValidationError";
    this.issues = issues;
  }
}

function toIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((i) => ({
    path: i.path.join(".") || "(body)",
    message: i.message,
  }));
}

/**
 * Parses an already-decoded value, raising the same `ValidationError` a bad
 * request body does.
 *
 * Needed wherever the body is optional or a different shape is acceptable —
 * `body()` can only reject a malformed request, it cannot allow "no body at
 * all". A bare `schema.parse` here would throw a raw `ZodError`, which the
 * error handler does not recognise, and a client mistake would come back as a
 * 500 instead of a 400 that says which field is wrong.
 */
export function parseValue<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(toIssues(parsed.error));
  return parsed.data;
}

/** Parses a JSON body. Malformed JSON and a schema mismatch are both 400. */
export async function body<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ValidationError([{ path: "(body)", message: "Malformed JSON" }]);
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(toIssues(parsed.error));
  }
  return parsed.data;
}

/** Parses path parameters. Catches `/api/x/../../etc` and non-uuid ids. */
export function params<T extends z.ZodTypeAny>(c: Context, schema: T): z.infer<T> {
  const parsed = schema.safeParse(c.req.param());
  if (!parsed.success) {
    throw new ValidationError(toIssues(parsed.error));
  }
  return parsed.data;
}

/**
 * Parses named query parameters. Separate from `params` because a route like
 * `/auth/verify?token=…` has no path parameters at all — reading it with
 * `c.req.param()` returns `{}` and validation would reject a perfectly good
 * request.
 */
export function query<T extends z.ZodTypeAny>(c: Context, schema: T): z.infer<T> {
  // URLSearchParams rather than a Hono helper: the shape of `req.querystring`
  // has changed between releases, and this is two lines.
  const search = new URL(c.req.url).searchParams;
  const raw: Record<string, string> = {};
  for (const [key, value] of search) raw[key] = value;

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(toIssues(parsed.error));
  }
  return parsed.data;
}

// ── Shared schemas ─────────────────────────────────────────────────────────

export const uuid = z
  .string()
  .uuid("Must be a uuid")
  .describe("a project, conversation, table or key identifier");

export const identifier = z
  .string()
  .regex(/^[a-z_][a-z0-9_]*$/i, "Must be a plain identifier: letters, digits, underscore")
  .max(63, "Too long");

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Not a valid email address");

/** A credential from a query string, as used by the magic-link callback. */
export const tokenParam = z.object({
  token: z.string().min(10, "Token is missing or too short").max(200),
});

export const effort = z.enum([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export const columnType = z.enum(["text", "number", "bool", "date"]);

export const columnSchema = z.object({
  name: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Column names must be plain identifiers")
    .max(63),
  type: columnType.default("text"),
  pk: z.boolean().optional(),
});

/** A prompt is stored, logged and echoed, so its length is bounded on purpose. */
export const prompt = z
  .string()
  .trim()
  .min(1, "Prompt cannot be empty")
  .max(32_000, "Prompt is too long");

export const agentKey = z.string().min(1).max(40);

export const terminalCommand = z
  .string()
  .trim()
  .min(1)
  .max(2_000, "Command is too long");

export const turnBody = z.object({
  conversationId: uuid,
  prompt,
  agent: agentKey.default("lolo"),
  model: z.string().min(1).max(120).default("qwen3:8b"),
  effort: effort.optional(),
  localModel: z.string().min(1).max(120).optional(),
});

export const createConversationBody = z.object({
  agent: agentKey.optional(),
  model: z.string().min(1).max(120).optional(),
});

/**
 * Query strings arrive as strings, so a numeric bound is a schema concern rather
 * than something each route should re-parse. Clamped rather than merely
 * checked: `?limit=100000` should not become a table scan.
 */
export const limitQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const updateConversationBody = z
  .object({
    agent: agentKey.optional(),
    model: z.string().min(1).max(120).optional(),
  })
  .refine((v) => v.agent !== undefined || v.model !== undefined, {
    message: "Provide agent, model, or both",
  });

export const magicLinkBody = z.object({ email });

export const createTableBody = z.object({
  name: identifier,
  columns: z.array(columnSchema).max(64).optional(),
});

/** Row values are free-form; the column list decides their types. */
export const rowBody = z.record(
  z.string().max(63),
  z.union([z.string().max(8_000), z.number(), z.boolean(), z.null()]),
);

export const patchRowBody = z.object({
  column: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Column names must be plain identifiers")
    .max(63),
  value: z.union([z.string().max(8_000), z.number(), z.boolean(), z.null()]),
});

export const queryBody = z.object({
  sql: z.string().trim().min(1, "Statement cannot be empty").max(20_000),
});

export const createKeyBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
});

export const createAccountBody = z.object({
  label: z.string().trim().min(1).max(60),
  tier: z.enum(["free", "subscribed"]).default("free"),
});

export const setStatusBody = z.object({
  status: z.enum(["healthy", "disabled"]),
});

export const chatBody = z.object({
  model: z.string().min(1).max(120),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant", "tool"]),
        content: z.string().max(64_000),
      }),
    )
    .min(1, "At least one message is required")
    .max(200, "Too many messages"),
  stream: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().max(32_000).optional(),
  agent: agentKey.optional(),
});
