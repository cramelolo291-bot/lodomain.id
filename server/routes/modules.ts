import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../auth/session";
import { db } from "../db/client";
import { moduleConnections } from "../db/schema";
import { body } from "../http/validate";

export const modules = new Hono();
modules.use("*", requireAuth);

const catalog = [
  { key: "messages", name: "Team messaging", source: "Rocket.Chat", runtime: "external", route: "/messages" },
  { key: "browser", name: "Browser agent", source: "OpenBrowser AI", runtime: "isolated-worker-required", route: "/browser" },
  { key: "security", name: "Security lab", source: "Strix", runtime: "isolated-worker-required", route: "/security" },
  { key: "cloud", name: "Cloud drive", source: "OmniCloud", runtime: "external", route: "/cloud" },
  { key: "reverse-engineering", name: "Reverse engineering", source: "REA", runtime: "isolated-worker-required", route: "/reverse-engineering" },
  { key: "deploy", name: "Deploy & hosting", source: "Railway", runtime: "external", route: "/deploy" },
  { key: "design", name: "Design quality", source: "anti-slop", runtime: "local-guidelines", route: "/design" },
] as const;

const moduleKey = z.enum([
  "messages", "browser", "security", "cloud", "reverse-engineering", "deploy", "design",
]);

const updateBody = z.object({
  endpointUrl: z.string().trim().url().max(2048).nullable().optional(),
  enabled: z.boolean().optional(),
}).strict().refine((value) => value.endpointUrl !== undefined || value.enabled !== undefined, {
  message: "Provide endpointUrl or enabled.",
});

function safeEndpoint(value: string | null | undefined) {
  if (!value) return null;
  const url = new URL(value);
  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
    throw new Error("Endpoint must use HTTPS, except HTTP on localhost during development.");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("Endpoint URLs cannot contain credentials or fragments.");
  }
  return url.toString().replace(/\/$/, "");
}

modules.get("/modules", async (c) => {
  const { userId } = c.get("session");
  const rows = await db.select().from(moduleConnections)
    .where(eq(moduleConnections.ownerId, userId))
    .orderBy(desc(moduleConnections.updatedAt));
  const byKey = new Map(rows.map((row) => [row.moduleKey, row]));

  return c.json({
    items: catalog.map((item) => {
      const row = byKey.get(item.key);
      return {
        ...item,
        enabled: row?.enabled ?? false,
        status: row?.status ?? "not_configured",
        endpointUrl: row?.endpointUrl ?? null,
        lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
        lastErrorCode: row?.lastErrorCode ?? null,
        updatedAt: row?.updatedAt?.toISOString() ?? null,
      };
    }),
    executionEnabled: false,
    note: "Connection metadata is persisted. Live provider adapters are not enabled until their runtime and health checks are installed.",
  });
});

modules.put("/modules/:key", async (c) => {
  const { userId } = c.get("session");
  const parsedKey = moduleKey.safeParse(c.req.param("key"));
  if (!parsedKey.success) return c.json({ error: { message: "Unknown module." } }, 404);

  const input = await body(c, updateBody);
  let endpointUrl: string | null | undefined;
  try {
    endpointUrl = input.endpointUrl === undefined ? undefined : safeEndpoint(input.endpointUrl);
  } catch (error) {
    return c.json({ error: { message: error instanceof Error ? error.message : "Invalid endpoint." } }, 400);
  }

  const item = catalog.find((entry) => entry.key === parsedKey.data)!;
  const existing = await db.select({ id: moduleConnections.id, status: moduleConnections.status, endpointUrl: moduleConnections.endpointUrl })
    .from(moduleConnections)
    .where(and(eq(moduleConnections.ownerId, userId), eq(moduleConnections.moduleKey, item.key)))
    .limit(1);

  const effectiveEndpointUrl = endpointUrl === undefined
    ? existing[0]?.endpointUrl ?? null
    : endpointUrl;
  const nextStatus = input.enabled === false
    ? effectiveEndpointUrl ? "disabled" : "not_configured"
    : input.enabled === true || endpointUrl !== undefined
      ? "pending"
      : existing[0]?.status ?? "not_configured";

  if (existing.length) {
    await db.update(moduleConnections).set({
      displayName: item.name,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(endpointUrl !== undefined ? { endpointUrl } : {}),
      status: nextStatus,
      lastErrorCode: null,
      updatedAt: new Date(),
    }).where(and(eq(moduleConnections.ownerId, userId), eq(moduleConnections.moduleKey, item.key)));
  } else {
    await db.insert(moduleConnections).values({
      ownerId: userId,
      moduleKey: item.key,
      displayName: item.name,
      enabled: input.enabled ?? false,
      status: nextStatus,
      endpointUrl: endpointUrl ?? null,
    });
  }

  return c.json({
    ok: true,
    module: item.key,
    status: nextStatus,
    executionEnabled: false,
    note: "Saved configuration metadata only; no external service was contacted or launched.",
  });
});

modules.delete("/modules/:key", async (c) => {
  const { userId } = c.get("session");
  const parsedKey = moduleKey.safeParse(c.req.param("key"));
  if (!parsedKey.success) return c.json({ error: { message: "Unknown module." } }, 404);
  await db.delete(moduleConnections).where(
    and(eq(moduleConnections.ownerId, userId), eq(moduleConnections.moduleKey, parsedKey.data)),
  );
  return c.json({ ok: true, module: parsedKey.data, status: "not_configured" });
});
