// Conversations, messages, turns, projects, files, terminal.
//
// Ownership is checked on every read and write. A conversation id alone is
// not authorisation — the session's userId must own the project it belongs to.

import { and, asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { requireAuth } from "../auth/session";
import { db } from "../db/client";
import { conversations, messages, projects, projectFiles } from "../db/schema";
import { runTurn } from "../pipeline/run-turn";
import { runCommand } from "../terminal/run";
import {
  body,
  createConversationBody,
  params,
  terminalCommand,
  turnBody,
  updateConversationBody,
  uuid,
} from "../http/validate";
import { z } from "zod";

export const routes = new Hono();
routes.use("*", requireAuth);

const conversationParams = z.object({ id: uuid });
const messageParams = z.object({ id: uuid });

/** The caller's default project, created on first use. */
async function ensureProject(userId: string, name = "lolo-app") {
  const existing = await db
    .select()
    .from(projects)
    .where(eq(projects.ownerId, userId))
    .orderBy(asc(projects.createdAt))
    .limit(1);

  if (existing[0]) return existing[0];
  const [created] = await db.insert(projects).values({ ownerId: userId, name }).returning();
  return created!;
}

// ── Projects ───────────────────────────────────────────────────────────────

routes.get("/project", async (c) => {
  const { userId } = c.get("session");
  const project = await ensureProject(userId);

  const files = await db
    .select({ path: projectFiles.path, content: projectFiles.content })
    .from(projectFiles)
    .where(eq(projectFiles.projectId, project.id));

  return c.json({
    name: project.name,
    files: Object.fromEntries(files.map((f) => [f.path, f.content])),
  });
});

routes.delete("/project", async (c) => {
  const { userId } = c.get("session");
  const project = await ensureProject(userId);
  // Cascades clear files, tables and conversations in the database.
  await db.delete(projects).where(eq(projects.id, project.id));
  return c.json({ ok: true });
});

// ── Conversations ──────────────────────────────────────────────────────────

routes.get("/conversations", async (c) => {
  const { userId } = c.get("session");
  const project = await ensureProject(userId);

  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      agent: conversations.agent,
      model: conversations.model,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(
      and(eq(conversations.projectId, project.id), eq(conversations.userId, userId)),
    )
    .orderBy(desc(conversations.updatedAt));

  return c.json(rows.map((r) => ({ ...r, updatedAt: r.updatedAt.getTime() })));
});

routes.post("/conversations", async (c) => {
  const { userId } = c.get("session");
  const input = await body(c, createConversationBody);
  const project = await ensureProject(userId);

  const [created] = await db
    .insert(conversations)
    .values({
      projectId: project.id,
      userId,
      title: "New run",
      agent: input.agent ?? "lolo",
      model: input.model ?? "qwen3:8b",
    })
    .returning();

  return c.json({
    id: created!.id,
    title: created!.title,
    agent: created!.agent,
    model: created!.model,
    updatedAt: created!.updatedAt.getTime(),
  });
});

routes.patch("/conversations/:id", async (c) => {
  const { userId } = c.get("session");
  const { id } = params(c, conversationParams);
  const input = await body(c, updateConversationBody);

  const [updated] = await db
    .update(conversations)
    .set({
      ...(input.agent ? { agent: input.agent } : {}),
      ...(input.model ? { model: input.model } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning();

  if (!updated) return c.json({ error: { message: "Not found" } }, 404);
  return c.json({ ok: true });
});

routes.delete("/conversations/:id", async (c) => {
  const { userId } = c.get("session");
  const { id } = params(c, conversationParams);
  await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
  return c.json({ ok: true });
});

routes.get("/conversations/:id/messages", async (c) => {
  const { userId } = c.get("session");
  const { id } = params(c, messageParams);

  const owned = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1);
  if (!owned[0]) return c.json({ error: { message: "Not found" } }, 404);

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));

  return c.json(
    rows.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      agent: m.agent ?? undefined,
      model: m.model ?? undefined,
      blocked: m.blocked,
      guardrail: m.guardrail ?? undefined,
      guardrailReason: m.guardrailReason ?? undefined,
      latencyMs: m.latencyMs ?? undefined,
      tokensIn: m.tokensIn ?? undefined,
      tokensOut: m.tokensOut ?? undefined,
      createdAt: m.createdAt.getTime(),
    })),
  );
});

// ── Turns ──────────────────────────────────────────────────────────────────

routes.post("/turn", async (c) => {
  const { userId } = c.get("session");
  const input = await body(c, turnBody);
  const project = await ensureProject(userId);

  // A conversation the caller does not own is a 404, not a 403: confirming it
  // exists would leak that it exists at all.
  const owned = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, userId)))
    .limit(1);
  if (!owned[0]) return c.json({ error: { message: "Not found" } }, 404);

  const result = await runTurn({
    conversationId: input.conversationId,
    projectId: project.id,
    userId,
    prompt: input.prompt,
    agent: input.agent,
    model: input.model,
    effort: input.effort,
    localModel: input.localModel,
  });

  if (result.status === "ok") {
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, input.conversationId));

    return c.json({
      status: "ok",
      traceId: result.traceId,
      changes: result.changes.map((f) => ({
        path: f.path,
        op: "created",
        before: null,
        after: f.content,
      })),
      summary: result.summary,
    });
  }
  if (result.status === "blocked") {
    return c.json({ status: "blocked", guardrail: result.guardrail });
  }
  return c.json(result, 502);
});

// ── Terminal ───────────────────────────────────────────────────────────────

routes.post("/terminal", async (c) => {
  const { userId } = c.get("session");
  const { cmd } = await body(c, z.object({ cmd: terminalCommand }));
  const project = await ensureProject(userId);

  const files = await db
    .select({ path: projectFiles.path, content: projectFiles.content })
    .from(projectFiles)
    .where(eq(projectFiles.projectId, project.id));

  return c.json(
    runCommand(cmd, Object.fromEntries(files.map((f) => [f.path, f.content]))),
  );
});
