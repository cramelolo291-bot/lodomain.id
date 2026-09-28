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
import { MAX_MODELS } from "../ollama/models";

export const routes = new Hono();
routes.use("*", requireAuth);

/** Loads a project the caller owns, or null. */
async function ownProject(projectId: string, userId: string) {
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

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

  return c.json({ name: project.name, files: Object.fromEntries(files.map((f) => [f.path, f.content])) });
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
  const body = (await c.req.json().catch(() => ({}))) as {
    agent?: string;
    model?: string;
  };
  const project = await ensureProject(userId);

  const [created] = await db
    .insert(conversations)
    .values({
      projectId: project.id,
      userId,
      title: "New run",
      agent: body.agent ?? "lolo",
      model: body.model ?? MAX_MODELS[0]!.id,
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
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as {
    agent?: string;
    model?: string;
  };

  const [updated] = await db
    .update(conversations)
    .set({
      ...(body.agent ? { agent: body.agent } : {}),
      ...(body.model ? { model: body.model } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning();

  if (!updated) return c.json({ error: { message: "Not found" } }, 404);
  return c.json({ ok: true });
});

routes.delete("/conversations/:id", async (c) => {
  const { userId } = c.get("session");
  await db
    .delete(conversations)
    .where(and(eq(conversations.id, c.req.param("id")), eq(conversations.userId, userId)));
  return c.json({ ok: true });
});

routes.get("/conversations/:id/messages", async (c) => {
  const { userId } = c.get("session");
  const id = c.req.param("id");

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
  const body = (await c.req.json().catch(() => ({}))) as {
    conversationId?: string;
    prompt?: string;
    agent?: string;
    model?: string;
  };

  if (!body.prompt) return c.json({ error: { message: "prompt is required" } }, 400);

  const project = await ensureProject(userId);

  // A conversation the caller does not own is a 404, not a 403: confirming it
  // exists would leak that it exists at all.
  const owned = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, body.conversationId ?? ""),
        eq(conversations.userId, userId),
      ),
    )
    .limit(1);
  if (!owned[0]) return c.json({ error: { message: "Not found" } }, 404);

  const result = await runTurn({
    conversationId: body.conversationId!,
    projectId: project.id,
    userId,
    prompt: body.prompt,
    agent: body.agent ?? "lolo",
    model: body.model ?? MAX_MODELS[0]!.id,
  });

  if (result.status === "ok") {
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, body.conversationId!));
  }

  if (result.status === "ok") {
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
  const body = (await c.req.json().catch(() => ({}))) as { cmd?: string };
  if (!body.cmd) return c.json({ error: { message: "cmd is required" } }, 400);

  const project = await ensureProject(userId);
  const files = await db
    .select({ path: projectFiles.path, content: projectFiles.content })
    .from(projectFiles)
    .where(eq(projectFiles.projectId, project.id));

  return c.json(runCommand(body.cmd, Object.fromEntries(files.map((f) => [f.path, f.content]))));
});
