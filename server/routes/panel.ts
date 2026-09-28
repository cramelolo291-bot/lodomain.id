// The operator's panel: pool state, traces, usage, guardrail findings, keys.
//
// Every route here is admin-gated. The account pool in particular is shared
// infrastructure — a user should not be able to see or disable it.

import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { requireAdmin, requireAuth } from "../auth/session";
import { db } from "../db/client";
import {
  apiKeys,
  guardrailHits,
  poolAccounts,
  traces,
  usageEvents,
} from "../db/schema";
import { env } from "../env";
import { GATEWAY_ROUTES } from "../../src/lib/catalog";
import { generateApiKey } from "../auth/tokens";
import { isUp, listModels } from "../ollama/client";
import { clearExpiredCooldowns, summary, withLiveStatus } from "../ollama/pool";
import { MAX_MODELS } from "../ollama/models";
import {
  body,
  createAccountBody,
  createKeyBody,
  limitQuery,
  params,
  query,
  setStatusBody,
  uuid,
} from "../http/validate";
import { z } from "zod";

export const panel = new Hono();

// ── Gateway ────────────────────────────────────────────────────────────────

panel.get("/gateway", requireAuth, async (c) => {
  const ok = await isUp();
  return c.json({
    upstream: env.OLLAMA_URL,
    listenAddr: `127.0.0.1:${env.PORT}`,
    status: ok ? "ok" : "down",
    keepaliveMs: env.OLLAMA_KEEPALIVE_MS,
    memoryEnabled: true,
    credits: MAX_MODELS.length,
  });
});

panel.get("/gateway/routes", requireAuth, (c) =>
  c.json(GATEWAY_ROUTES.map((r) => ({ ...r }))),
);

/** What Ollama has actually pulled, plus what the catalogue expects. */
panel.get("/models", requireAuth, async (c) => {
  let installed: Awaited<ReturnType<typeof listModels>> = [];
  let error: string | null = null;
  try {
    installed = await listModels();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return c.json({ installed, expected: MAX_MODELS, error });
});

// ── Pool ───────────────────────────────────────────────────────────────────

panel.get("/pool", requireAdmin, async (c) => {
  const accounts = await withLiveStatus(db);
  return c.json({ accounts, summary: await summary(db) });
});

panel.post("/pool", requireAdmin, async (c) => {
  const { label, tier } = await body(c, createAccountBody);

  // Slot and concurrency come from the tier table, never from the request.
  const limits =
    tier === "subscribed" ? { slots: 3, concurrency: 8 } : { slots: 1, concurrency: 3 };

  const exists = await db
    .select({ id: poolAccounts.id })
    .from(poolAccounts)
    .where(eq(poolAccounts.label, label))
    .limit(1);
  if (exists[0]) return c.json({ error: { message: "Label already exists" } }, 409);

  await db.insert(poolAccounts).values({
    label,
    tier,
    maxSlots: limits.slots,
    concurrency: limits.concurrency,
  });
  return c.json({ ok: true });
});

panel.patch("/pool/:id", requireAdmin, async (c) => {
  const { id } = params(c, z.object({ id: uuid }));
  const { status } = await body(c, setStatusBody);

  const [updated] = await db
    .update(poolAccounts)
    .set({ status })
    .where(eq(poolAccounts.id, id))
    .returning({ id: poolAccounts.id });
  if (!updated) return c.json({ error: { message: "Not found" } }, 404);
  return c.json({ ok: true });
});

panel.delete("/pool/:id", requireAdmin, async (c) => {
  const { id } = params(c, z.object({ id: uuid }));
  await db.delete(poolAccounts).where(eq(poolAccounts.id, id));
  return c.json({ ok: true });
});

panel.post("/pool/clear-cooldowns", requireAdmin, async (c) => {
  const n = await clearExpiredCooldowns();
  return c.json({ cleared: n });
});

// ── Traces ─────────────────────────────────────────────────────────────────

panel.get("/traces", requireAuth, async (c) => {
  const { userId } = c.get("session");
  const { limit } = query(c, limitQuery);
  const rows = await db
    .select()
    .from(traces)
    .where(eq(traces.userId, userId))
    .orderBy(desc(traces.createdAt))
    .limit(limit);

  return c.json(
    rows.map((t) => ({
      id: t.id,
      conversationId: t.conversationId ?? "",
      prompt: t.prompt,
      agent: t.agent,
      model: t.model,
      account: t.account ?? "",
      ok: t.ok,
      totalMs: t.totalMs,
      tokensIn: t.tokensIn,
      tokensOut: t.tokensOut,
      steps: t.steps,
    })),
  );
});

// ── Usage ──────────────────────────────────────────────────────────────────

panel.get("/usage", requireAuth, async (c) => {
  const { userId } = c.get("session");
  const dayAgo = new Date(Date.now() - 86_400_000);

  const [totals] = await db
    .select({
      requests: count(),
      tokensIn: sql<number>`coalesce(sum(${usageEvents.tokensIn}), 0)::int`,
      tokensOut: sql<number>`coalesce(sum(${usageEvents.tokensOut}), 0)::int`,
      failures: sql<number>`coalesce(sum(case when ${usageEvents.ok} = false then 1 else 0 end), 0)::int`,
      avgLatency: sql<number>`coalesce(round(avg(${usageEvents.latencyMs})), 0)::int`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, dayAgo)));

  const byModel = await db
    .select({
      model: usageEvents.model,
      requests: count(),
      tokensOut: sql<number>`coalesce(sum(${usageEvents.tokensOut}), 0)::int`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, dayAgo)))
    .groupBy(usageEvents.model)
    .orderBy(desc(sql`coalesce(sum(${usageEvents.tokensOut}), 0)`));

  return c.json({
    requests: totals?.requests ?? 0,
    tokensIn: totals?.tokensIn ?? 0,
    tokensOut: totals?.tokensOut ?? 0,
    failures: totals?.failures ?? 0,
    avgLatency: totals?.avgLatency ?? 0,
    freebucks: { used: totals?.tokensOut ?? 0, limit: 0, resetsAt: null },
    byModel,
  });
});

// ── Guardrails ─────────────────────────────────────────────────────────────

panel.get("/guardrails", requireAdmin, async (c) => {
  const rows = await db
    .select()
    .from(guardrailHits)
    .orderBy(desc(guardrailHits.createdAt))
    .limit(100);

  const byCategory = new Map<string, number>();
  for (const r of rows) {
    byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
  }

  return c.json({
    rules: [],
    hits: rows.map((r) => ({
      id: r.id,
      category: r.category,
      severity: r.severity,
      direction: r.direction,
      match: r.match,
      excerpt: r.excerpt,
      createdAt: r.createdAt.getTime(),
    })),
    byCategory: Object.fromEntries(byCategory),
  });
});

// ── API keys ───────────────────────────────────────────────────────────────

panel.get("/keys", requireAuth, async (c) => {
  const { userId } = c.get("session");
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      revokedAt: apiKeys.revokedAt,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt));

  return c.json(
    rows.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      revoked: k.revokedAt !== null,
      lastUsedAt: k.lastUsedAt?.getTime(),
      createdAt: k.createdAt.getTime(),
    })),
  );
});

panel.post("/keys", requireAuth, async (c) => {
  const { userId } = c.get("session");
  const { name } = await body(c, createKeyBody);

  const { secret, prefix, hash } = generateApiKey();
  const [created] = await db
    .insert(apiKeys)
    .values({ userId, name, prefix, secretHash: hash })
    .returning({ id: apiKeys.id });

  // The only time the plaintext exists outside the client's hands.
  return c.json({ id: created!.id, secret });
});

panel.delete("/keys/:id", requireAuth, async (c) => {
  const { userId } = c.get("session");
  const { id } = params(c, z.object({ id: uuid }));
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)));
  return c.json({ ok: true });
});
