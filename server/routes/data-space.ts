// The per-project data space, backed by real tables.
//
// Every statement here touches only tables belonging to a project the caller
// owns. A table name arrives as a URL segment, so it is bound as a parameter
// and never interpolated into SQL.

import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { sql, type SQL } from "drizzle-orm";
import { requireAuth } from "../auth/session";
import { db, pool } from "../db/client";
import {
  projects,
  projectColumns,
  projectRows,
  projectTables,
} from "../db/schema";
import { applySql } from "../lib/data-sql";

export const dataSpace = new Hono();
dataSpace.use("*", requireAuth);

type Value = string | number | boolean | null;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const project = await resolveProject(c.req.param("project"), userId);
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
      columns: columns.map((c2) => ({
        name: c2.name,
        type: c2.type,
        pk: c2.isPk,
      })),
      rows: rows.map((r) => r.data as Record<string, Value>),
    });
  }

  return c.json(out);
});

dataSpace.post("/projects/:project/tables", async (c) => {
  const { userId } = c.get("session");
  const project = await resolveProject(c.req.param("project"), userId);
  if (!project) return c.json({ error: { message: "Not found" } }, 404);

  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    columns?: Array<{ name: string; type: string; pk?: boolean }>;
  };

  const name = body.name?.trim();
  if (!name) return c.json({ error: { message: "name is required" } }, 400);
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    return c.json({ error: { message: "Table name must be a plain identifier" } }, 400);
  }

  const exists = await db
    .select({ id: projectTables.id })
    .from(projectTables)
    .where(and(eq(projectTables.projectId, project.id), eq(projectTables.name, name)))
    .limit(1);
  if (exists[0]) {
    return c.json({ error: { message: `Table already exists: ${name}` } }, 409);
  }

  const [created] = await db
    .insert(projectTables)
    .values({ projectId: project.id, name })
    .returning();

  const columns = body.columns?.length ? body.columns : [{ name: "id", type: "number", pk: true }];
  await db.insert(projectColumns).values(
    columns.map((col, i) => ({
      tableId: created!.id,
      name: col.name,
      type: (["text", "number", "bool", "date"].includes(col.type)
        ? col.type
        : "text") as "text" | "number" | "bool" | "date",
      isPk: col.pk ?? false,
      position: i,
    })),
  );

  return c.json({ id: created!.id, name: created!.name });
});

dataSpace.delete("/projects/:project/tables/:table", async (c) => {
  const { userId } = c.get("session");
  const project = await resolveProject(c.req.param("project"), userId);
  if (!project) return c.json({ error: { message: "Not found" } }, 404);

  const found = await db
    .select({ id: projectTables.id })
    .from(projectTables)
    .where(
      and(
        eq(projectTables.projectId, project.id),
        eq(projectTables.name, c.req.param("table")),
      ),
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
  const project = await resolveProject(c.req.param("project"), userId);
  if (!project) return c.json({ error: { message: "Not found" } }, 404);

  const table = await findTable(project.id, c.req.param("table"));
  if (!table) return c.json({ error: { message: "Not found" } }, 404);

  const columns = await db
    .select()
    .from(projectColumns)
    .where(eq(projectColumns.tableId, table.id));
  const pk = columns.find((col) => col.isPk);

  const incoming = (await c.req.json().catch(() => ({}))) as Record<string, Value>;
  const data: Record<string, Value> = {};
  for (const col of columns) data[col.name] = incoming[col.name] ?? null;

  if (pk) {
    // Explicit ids are honoured so imported data keeps its keys; otherwise the
    // next integer after the current maximum is allocated. The payload is
    // jsonb, so the maximum has to be computed in SQL.
    if (data[pk.name] === null || data[pk.name] === undefined) {
      const counted = await pool<{ max: number | null }[]>`
        select max((data->>${pk.name})::bigint) as max
          from project_rows
         where table_id = ${table.id}
      `;
      data[pk.name] = Number(counted[0]?.max ?? 0) + 1;
    }
  }

  const [created] = await db
    .insert(projectRows)
    .values({ tableId: table.id, data })
    .returning({ id: projectRows.id, data: projectRows.data });

  return c.json(created!.data as Record<string, Value>);
});

dataSpace.patch("/projects/:project/tables/:table/rows/:rowId", async (c) => {
  const { userId } = c.get("session");
  const project = await resolveProject(c.req.param("project"), userId);
  if (!project) return c.json({ error: { message: "Not found" } }, 404);

  const table = await findTable(project.id, c.req.param("table"));
  if (!table) return c.json({ error: { message: "Not found" } }, 404);

  const body = (await c.req.json().catch(() => ({}))) as {
    column?: string;
    value?: Value;
  };
  if (!body.column) return c.json({ error: { message: "column is required" } }, 400);

  const columns = await db
    .select()
    .from(projectColumns)
    .where(eq(projectColumns.tableId, table.id));
  const col = columns.find((x) => x.name === body.column);
  if (!col) return c.json({ error: { message: `Unknown column: ${body.column}` } }, 400);

  const rowId = c.req.param("rowId");
  const [existing] = await db
    .select({ data: projectRows.data })
    .from(projectRows)
    .where(and(eq(projectRows.id, rowId), eq(projectRows.tableId, table.id)))
    .limit(1);
  if (!existing) return c.json({ error: { message: "Not found" } }, 404);

  const merged = { ...(existing.data as Record<string, Value>), [col.name]: body.value ?? null };

  const [updated] = await db
    .update(projectRows)
    .set({ data: merged })
    .where(eq(projectRows.id, rowId))
    .returning({ data: projectRows.data });

  return c.json(updated!.data as Record<string, Value>);
});

dataSpace.delete("/projects/:project/tables/:table/rows/:rowId", async (c) => {
  const { userId } = c.get("session");
  const project = await resolveProject(c.req.param("project"), userId);
  if (!project) return c.json({ error: { message: "Not found" } }, 404);

  const table = await findTable(project.id, c.req.param("table"));
  if (!table) return c.json({ error: { message: "Not found" } }, 404);

  const pkName = c.req.query("pk") ?? "id";
  const key = c.req.param("rowId");

  // Row ids are uuids on the server; the grid addresses rows by their primary
  // key value, so the row is resolved through the jsonb payload.
  const [row] = await db
    .select({ id: projectRows.id })
    .from(projectRows)
    .where(
      and(
        eq(projectRows.tableId, table.id),
        sql`${projectRows.data}->>${pkName} = ${key}`,
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
  const project = await resolveProject(c.req.param("project"), userId);
  if (!project) return c.json({ error: { message: "Not found" } }, 404);

  const body = (await c.req.json().catch(() => ({}))) as { sql?: string };
  if (!body.sql) return c.json({ error: { message: "sql is required" } }, 400);

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
      columns: columns.map((c2) => ({ name: c2.name, type: c2.type, pk: c2.isPk })),
      rows: rows.map((r) => r.data as Record<string, Value>),
    });
  }

  const outcome = applySql(hydrated, body.sql);

  // Persist whatever the statement changed.
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
      const match = before.rows.find((r) => JSON.stringify(r) === JSON.stringify(row));
      if (match) {
        await db
          .insert(projectRows)
          .values({ tableId: t.id, data: row })
          .onConflictDoNothing();
      } else {
        await db.insert(projectRows).values({ tableId: t.id, data: row });
      }
    }
  }

  return c.json(outcome.result);
});

export type { SQL };
