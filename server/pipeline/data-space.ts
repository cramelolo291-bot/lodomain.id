// Turning a blueprint into real tables in the project's data space.
//
// The shapes come from `src/lib/data.ts` so the browser mock and the server
// provision the same tables for the same prompt. What differs is only where
// they land: here it is `project_tables` / `project_columns` / `project_rows`.
//
// Additive by construction. A table that already exists is left alone, so
// replaying a turn — or two agents racing to build the same schema — cannot
// destroy data that is already there.

import { and, asc, eq } from "drizzle-orm";
import { db, type Db } from "../db/client";
import { projectColumns, projectRows, projectTables } from "../db/schema";
import type { Table } from "../../src/lib/data";

export type Provisioned = { name: string; rows: number };

/** Tables already in this project, by name. */
async function existingNames(database: Db, projectId: string): Promise<Set<string>> {
  const rows = await database
    .select({ name: projectTables.name })
    .from(projectTables)
    .where(eq(projectTables.projectId, projectId));
  return new Set(rows.map((r) => r.name));
}

/**
 * Creates any of `incoming` that the project does not have yet. Returns what was
 * actually created, so the trace can report it rather than claiming work that
 * was skipped.
 */
export async function provisionTables(
  database: Db,
  projectId: string,
  incoming: Table[],
): Promise<Provisioned[]> {
  if (incoming.length === 0) return [];

  const present = await existingNames(database, projectId);
  const created: Provisioned[] = [];

  for (const table of incoming) {
    if (present.has(table.name)) continue;

    const [row] = await database
      .insert(projectTables)
      .values({ projectId, name: table.name })
      .returning({ id: projectTables.id });

    if (!row) continue;

    await database.insert(projectColumns).values(
      table.columns.map((col, i) => ({
        tableId: row.id,
        name: col.name,
        type: col.type,
        isPk: col.pk ?? false,
        position: i,
      })),
    );

    if (table.rows.length > 0) {
      // Every value is coerced through the column type on the way in, so a
      // seeded `"42"` in a number column is stored as a number.
      const byName = new Map(table.columns.map((c) => [c.name, c]));
      await database.insert(projectRows).values(
        table.rows.map((r) => {
          const data: Record<string, string | number | boolean | null> = {};
          for (const col of table.columns) {
            const value = r[col.name];
            data[col.name] = coerce(value, byName.get(col.name)?.type ?? "text");
          }
          return { tableId: row.id, data };
        }),
      );
    }

    present.add(table.name);
    created.push({ name: table.name, rows: table.rows.length });
  }

  return created;
}

function coerce(value: unknown, type: string): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (type === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "bool") {
    if (typeof value === "boolean") return value;
    return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
  }
  return String(value);
}

/** Count of rows across the project, for the trace and the panel header. */
export async function dataSpaceSize(database: Db, projectId: string): Promise<number> {
  const tables = await database
    .select({ id: projectTables.id })
    .from(projectTables)
    .where(eq(projectTables.projectId, projectId));

  if (tables.length === 0) return 0;

  let total = 0;
  for (const t of tables) {
    const rows = await database
      .select({ id: projectRows.id })
      .from(projectRows)
      .where(eq(projectRows.tableId, t.id));
    total += rows.length;
  }
  return total;
}

/** Re-exported so routes do not need to know the join order. */
export { and, asc, eq, db };
