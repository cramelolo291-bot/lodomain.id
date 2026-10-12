// The per-project data space, backed by real tables.
//
// Every statement here touches only tables belonging to a project the caller
// owns. A table name arrives as a URL segment or a body field, so it is
// validated against an identifier pattern and bound as a parameter — never
// interpolated into SQL.

import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { requireAuth } from "../auth/session";
import { db, pool } from "../db/client";
import { projects, projectColumns, projectRows, projectTables } from "../db/schema";
import { applySql } from "../lib/data-sql";
import {
  body,
  createTableBody,
  identifier,
  params,
  patchRowBody,
  queryBody,
  rowBody,
} from "../http/validate";
import { z } from "zod";

export const dataSpace = new Hono();
dataSpace.use("*", requireAuth);

type Value = string | number | boolean | null;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tableParams = z.object({
  project: z.string().min(1).max(120),
  table: identifier,
});

const rowParams = tableParams.extend({ rowId: z.string().min(1).max(80) });

/**
 * Resolves the caller's project from either a uuid or its name. The workspace
 * UI addresses projects by name, so every route has to accept both.
 *
 * The shape check is not optional: `projects.id` is a uuid column, and
 * comparing it to "lolo-app" raises `invalid input syntax for type uuid`
 * before the name fallback is ever reached.
 */
async function resolveProject(idOrName: string, userId: string) {
  if (UUID.test(idOrName)) {
    const byId = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, idOrName), eq(projects.ownerId, userId)))
      .limit(1);
    if (byId[0]) return byId[0];
  }

  const byName = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.name, idOrName), eq(projects.ownerId, userId)))
    .limit(1);
  return byName[0] ?? null;
}

// ── Tables ─────────────────────────────────────────────────────────────────

dataSpace.get("/projects/:project/tables", async (c) => {
  const { userId } = c.get("session");
  const { project: ref } = params(c, z.object({ project: z.string().min(1).max(120) }));

  const project = await resolveProject(ref, userId);
  if (!project) return c.json({ error: { message: "Not found" } }, 404);

  const tables = await db
    .select()
    .from(projectTables)
    .where(eq(projectTables.projectId, project.id))
    .orderBy(asc(projectTables.createdAt));

  const out = [];
  for (const t of tables) {
    const columns = await db
      .select()
      .from(projectColumns)
      .where(eq(projectColumns.tableId, t.id))
      .orderBy(asc(projectColumns.position));

    const rows = await db
      .select({ data: projectRows.data })
      .from(projectRows)
      .where(eq(projectRows.tableId, t.id))
      .orderBy(asc(projectRows.createdAt));

    out.push({
      id: t.id,
      name: t.name,
      columns: columns.map((col) => ({
        name: col.name,
        type: col.type,
        pk: col.isPk,
      })),
      rows: rows.map((r) => r.data as Record<string, Value>),
    });
  }

  return c.json(out);
});

dataSpace.post("/projects/:project/tables", async (c) => {
  const { userId } = c.get("session");
  const { project: ref } = params(c, z.object({ project: z.string().min(1).max(120) }));
  const input = await body(c, createTableBody);

  const project = await resolveProject(ref, userId);
  if (!project) return c.json({ error: { message: "Not found" } }, 404);

  const exists = await db
    .select({ id: projectTables.id })
    .from(projectTables)
    .where(and(eq(projectTables.projectId, project.id), eq(projectTables.name, input.name)))
    .limit(1);
  if (exists[0]) {
    return c.json({ error: { message: `Table already exists: ${input.name}` } }, 409);
  }

  const [created] = await db
    .insert(projectTables)
    .values({ projectId: project.id, name: input.name })
    .returning();

  const columns = input.columns?.length
    ? input.columns
    : [{ name: "id", type: "number" as const, pk: true }];

  // Two tables with the same column name would violate the composite key, so
  // duplicates are dropped rather than failing the whole request.
  const seen = new Set<string>();
  const unique = columns.filter((col) => {
    if (seen.has(col.name)) return false;
    seen.add(col.name);
    return true;
  });

  await db.insert(projectColumns).values(
    unique.map((col, i) => ({
      tableId: created!.id,
      name: col.name,
      type: col.type,
      isPk: col.pk ?? false,
      position: i,
    })),
  );

  return c.json({ id: created!.id, name: created!.name });
});

dataSpace.delete("/projects/:project/tables/:table", async (c) => {
  const { userId } = c.get("session");
  const { project: ref, table } = params(c, tableParams);

  const project = await resolveProject(ref, userId);
  if (!project) return c.json({ error: { message: "Not found" } }, 404);

  const found = await db
    .select({ id: projectTables.id })
    .from(projectTables)
    .where(
      and(eq(projectTables.projectId, project.id), eq(projectTables.name, table)),
    )
    .limit(1);
  if (!found[0]) return c.json({ error: { message: "Not found" } }, 404);

  // Columns and rows cascade.
  await db.delete(projectTables).where(eq(projectTables.id, found[0].id));
  return c.json({ ok: true });
});

// ── Rows ───────────────────────────────────────────────────────────────────

async function findTable(projectId: string, name: string) {
  const rows = await db
    .select({ id: projectTables.id, name: projectTables.name })
    .from(projectTables)
    .where(and(eq(projectTables.projectId, projectId), eq(projectTables.name, name)))
    .limit(1);
  return rows[0] ?? null;
}

dataSpace.post("/projects/:project/tables/:table/rows", async (c) => {
  const { userId } = c.get("session");
  const { project: ref, table } = params(c, tableParams);
  const incoming = await body(c, rowBody);

  const project = await resolveProject(ref, userId);
  if (!project) return c.json({ error: { message: "Not found" } }, 404);

  const target = await findTable(project.id, table);
  if (!target) return c.json({ error: { message: "Not found" } }, 404);

  const columns = await db
    .select()
    .from(projectColumns)
    .where(eq(projectColumns.tableId, target.id));
  const pk = columns.find((col) => col.isPk);

  // Unknown keys in the request are dropped rather than stored, so a typo
  // cannot silently create a column the schema does not declare.
  const known = new Set(columns.map((col) => col.name));
  const data: Record<string, Value> = {};
  for (const col of columns) {
    data[col.name] = known.has(col.name) ? (incoming[col.name] ?? null) : null;
  }

  if (pk && (data[pk.name] === null || data[pk.name] === undefined)) {
    const counted = await pool<{ max: number | null }[]>`
      select max((data->>${pk.name})::bigint) as max
        from project_rows
       where table_id = ${target.id}
    `;
    data[pk.name] = Number(counted[0]?.max ?? 0) + 1;
  }

  const [created] = await db
    .insert(projectRows)
    .values({ tableId: target.id, data })
    .returning({ data: projectRows.data });

  return c.json(created!.data as Record<string, Value>);
});

dataSpace.patch("/projects/:project/tables/:table/rows/:rowId", async (c) => {
  const { userId } = c.get("session");
  const { project: ref, table, rowId } = params(c, rowParams);
  const input = await body(c, patchRowBody);

  const project = await resolveProject(ref, userId);
  if (!project) return c.json({ error: { message: "Not found" } }, 404);

  const target = await findTable(project.id, table);
  if (!target) return c.json({ error: { message: "Not found" } }, 404);

  const columns = await db
    .select()
    .from(projectColumns)
    .where(eq(projectColumns.tableId, target.id));
  const col = columns.find((x) => x.name === input.column);
  if (!col) return c.json({ error: { message: `Unknown column: ${input.column}` } }, 400);

  const [existing] = await db
    .select({ data: projectRows.data })
    .from(projectRows)
    .where(and(eq(projectRows.id, rowId), eq(projectRows.tableId, target.id)))
    .limit(1);
  if (!existing) return c.json({ error: { message: "Not found" } }, 404);

  const merged = {
    ...(existing.data as Record<string, Value>),
    [col.name]: input.value ?? null,
  };

  const [updated] = await db
    .update(projectRows)
    .set({ data: merged })
    .where(eq(projectRows.id, rowId))
    .returning({ data: projectRows.data });

  return c.json(updated!.data as Record<string, Value>);
});

dataSpace.delete("/projects/:project/tables/:table/rows/:rowId", async (c) => {
  const { userId } = c.get("session");
  const { project: ref, table } = params(c, rowParams);
  const pk = c.req.query("pk") ?? "id";
  const key = c.req.param("rowId");

  const project = await resolveProject(ref, userId);
  if (!project) return c.json({ error: { message: "Not found" } }, 404);

  const target = await findTable(project.id, table);
  if (!target) return c.json({ error: { message: "Not found" } }, 404);

  // Row ids are uuids on the server; the grid addresses rows by their primary
  // key value, so the row is resolved through the jsonb payload.
  const [row] = await db
    .select({ id: projectRows.id })
    .from(projectRows)
    .where(
      and(
        eq(projectRows.tableId, target.id),
        sql`${projectRows.data}->>${pk} = ${key}`,
      ),
    )
    .limit(1);

  if (!row) return c.json({ error: { message: "Not found" } }, 404);
  await db.delete(projectRows).where(eq(projectRows.id, row.id));
  return c.json({ ok: true });
});

// ── SQL console ────────────────────────────────────────────────────────────

/**
 * Reads a statement through the same parser the browser preview uses, so both
 * surfaces behave identically. Writes go through the Drizzle path above, which
 * keeps ownership checks in one place.
 */
dataSpace.post("/projects/:project/query", async (c) => {
  const { userId } = c.get("session");
  const { project: ref } = params(c, z.object({ project: z.string().min(1).max(120) }));
  const { sql: statement } = await body(c, queryBody);

  const project = await resolveProject(ref, userId);
  if (!project) return c.json({ error: { message: "Not found" } }, 404);

  const tables = await db
    .select()
    .from(projectTables)
    .where(eq(projectTables.projectId, project.id));

  const hydrated = [];
  for (const t of tables) {
    const columns = await db
      .select()
      .from(projectColumns)
      .where(eq(projectColumns.tableId, t.id))
      .orderBy(asc(projectColumns.position));
    const rows = await db
      .select({ data: projectRows.data })
      .from(projectRows)
      .where(eq(projectRows.tableId, t.id))
      .orderBy(asc(projectRows.createdAt));

    hydrated.push({
      name: t.name,
      id: t.id,
      columns: columns.map((col) => ({
        name: col.name,
        type: col.type,
        pk: col.isPk,
      })),
      rows: rows.map((r) => r.data as Record<string, Value>),
    });
  }

  const outcome = applySql(hydrated, statement);

  for (const t of outcome.tables) {
    if (!t.id) continue;
    const before = hydrated.find((h) => h.name === t.name);
    if (!before || before.rows.length === t.rows.length) continue;

    if (t.rows.length < before.rows.length) {
      const keep = new Set(t.rows.map((r) => JSON.stringify(r)));
      const doomed = await db
        .select({ id: projectRows.id, data: projectRows.data })
        .from(projectRows)
        .where(eq(projectRows.tableId, t.id));
      for (const row of doomed) {
        if (!keep.has(JSON.stringify(row.data))) {
          await db.delete(projectRows).where(eq(projectRows.id, row.id));
        }
      }
    }

    for (const row of t.rows) {
      const exists = before.rows.some((r) => JSON.stringify(r) === JSON.stringify(row));
      if (exists) {
        await db.insert(projectRows).values({ tableId: t.id, data: row }).onConflictDoNothing();
      } else {
        await db.insert(projectRows).values({ tableId: t.id, data: row });
      }
    }
  }

  return c.json(outcome.result);
});
