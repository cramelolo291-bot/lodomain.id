import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../auth/session";
import { pool } from "../db/client";
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
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("Endpoint must use HTTPS, except localhost during development.");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("Endpoint URLs cannot contain credentials or fragments.");
  }
  return url.toString().replace(/\/$/, "");
}

modules.get("/modules", async (c) => {
  const { userId } = c.get("session");
  const rows = await pool<{
    module_key: string;
    display_name: string;
    enabled: boolean;
    status: string;
    endpoint_url: string | null;
    last_checked_at: Date | null;
    last_error_code: string | null;
    updated_at: Date;
  }[]> `
    select module_key, display_name, enabled, status, endpoint_url,
           last_checked_at, last_error_code, updated_at
    from module_connections
    where owner_id = ${userId}
    order by updated_at desc
  `;
  const byKey = new Map(rows.map((row) => [row.module_key, row]));
  return c.json({
    items: catalog.map((item) => {
      const row = byKey.get(item.key);
      return {
        ...item,
        enabled: row?.enabled ?? false,
        status: row?.status ?? "not_configured",
        endpointUrl: row?.endpoint_url ?? null,
        lastCheckedAt: row?.last_checked_at?.toISOString() ?? null,
        lastErrorCode: row?.last_error_code ?? null,
        updatedAt: row?.updated_at?.toISOString() ?? null,
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
  const existing = await pool<{ id: string }[]> `
    select id from module_connections
    where owner_id = ${userId} and module_key = ${item.key}
    limit 1
  `;

  const enabled = input.enabled;
  const status = enabled === false ? "disabled" : "pending";
  if (existing.length) {
    await pool `
      update module_connections
      set display_name = ${item.name},
          enabled = coalesce(${enabled ?? null}, enabled),
          endpoint_url = case when ${endpointUrl === undefined} then endpoint_url else ${endpointUrl ?? null} end,
          status = case when ${enabled === false} then 'disabled'
                        when ${enabled === true} then 'pending'
                        when ${endpointUrl !== undefined} then 'pending'
                        else status end,
          last_error_code = null,
          updated_at = now()
      where owner_id = ${userId} and module_key = ${item.key}
    `;
  } else {
    await pool `
      insert into module_connections
        (owner_id, module_key, display_name, enabled, status, endpoint_url)
      values (
        ${userId}, ${item.key}, ${item.name}, ${enabled ?? false},
        ${enabled ? "pending" : "not_configured"}, ${endpointUrl ?? null}
      )
    `;
  }

  return c.json({
    ok: true,
    module: item.key,
    status: enabled === false ? "disabled" : enabled === true || endpointUrl ? "pending" : "not_configured",
    executionEnabled: false,
    note: "Saved configuration metadata only; no external service was contacted or launched.",
  });
});

modules.delete("/modules/:key", async (c) => {
  const { userId } = c.get("session");
  const parsedKey = moduleKey.safeParse(c.req.param("key"));
  if (!parsedKey.success) return c.json({ error: { message: "Unknown module." } }, 404);
  await pool `
    delete from module_connections
    where owner_id = ${userId} and module_key = ${parsedKey.data}
  `;
  return c.json({ ok: true, module: parsedKey.data, status: "not_configured" });
});
