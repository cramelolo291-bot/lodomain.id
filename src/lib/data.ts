// Per-project data space.
//
// Every project gets its own set of tables and rows, persisted alongside the
// files. The agent can create tables; the user can read, edit, add and delete
// rows from the workspace. No row caps, no table caps, no pagination — the
// store is the whole surface.

export type ColumnType = "text" | "number" | "bool" | "date";

export type Column = {
  name: string;
  type: ColumnType;
  pk?: boolean;
};

export type Row = Record<string, string | number | boolean | null>;

export type Table = {
  name: string;
  columns: Column[];
  rows: Row[];
};

export type DataSpace = Record<string, Table[]>;

export type QueryResult = {
  columns: string[];
  rows: Row[];
  /** Set when the statement was not a read. */
  affected: number;
  note?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────

export function coerce(value: unknown, type: ColumnType): Row[string] {
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

function seedTables(): Table[] {
  const stamp = Date.now();

  return [
    {
      name: "users",
      columns: [
        { name: "id", type: "number", pk: true },
        { name: "email", type: "text" },
        { name: "name", type: "text" },
        { name: "role", type: "text" },
        { name: "active", type: "bool" },
      ],
      rows: [
        { id: 1, email: "lo@lolo.ai", name: "Lolo", role: "admin", active: true },
        {
          id: 2,
          email: "rafi@lolo.ai",
          name: "Rafi",
          role: "user",
          active: true,
        },
        {
          id: 3,
          email: "dimas@lolo.ai",
          name: "Dimas",
          role: "user",
          active: false,
        },
      ],
    },
    {
      name: "conversations",
      columns: [
        { name: "id", type: "number", pk: true },
        { name: "title", type: "text" },
        { name: "agent", type: "text" },
        { name: "model", type: "text" },
        { name: "created_at", type: "date" },
      ],
      rows: [
        {
          id: 1,
          title: "Bikin aplikasi web baru",
          agent: "lolo",
          model: "z-ai/glm-5.3-flash",
          created_at: new Date(stamp - 3600_000).toISOString(),
        },
        {
          id: 2,
          title: "Bikin skema Postgres",
          agent: "forge",
          model: "deepseek/deepseek-v4.1-flash",
          created_at: new Date(stamp - 7200_000).toISOString(),
        },
      ],
    },
    {
      name: "pool_accounts",
      columns: [
        { name: "label", type: "text", pk: true },
        { name: "tier", type: "text" },
        { name: "status", type: "text" },
        { name: "health", type: "number" },
        { name: "in_flight", type: "number" },
        { name: "max_slots", type: "number" },
      ],
      rows: [
        {
          label: "free-primary",
          tier: "free",
          status: "healthy",
          health: 92,
          in_flight: 0,
          max_slots: 1,
        },
        {
          label: "subscribed-1",
          tier: "subscribed",
          status: "healthy",
          health: 97,
          in_flight: 1,
          max_slots: 3,
        },
        {
          label: "free-legacy",
          tier: "free",
          status: "degraded",
          health: 41,
          in_flight: 0,
          max_slots: 1,
        },
      ],
    },
    {
      name: "usage_events",
      columns: [
        { name: "id", type: "number", pk: true },
        { name: "model", type: "text" },
        { name: "agent", type: "text" },
        { name: "tokens_in", type: "number" },
        { name: "tokens_out", type: "number" },
        { name: "latency_ms", type: "number" },
        { name: "ok", type: "bool" },
      ],
      rows: [
        {
          id: 1,
          model: "z-ai/glm-5.3-flash",
          agent: "lolo",
          tokens_in: 812,
          tokens_out: 247,
          latency_ms: 4310,
          ok: true,
        },
        {
          id: 2,
          model: "deepseek/deepseek-v4.1-flash",
          agent: "forge",
          tokens_in: 1240,
          tokens_out: 512,
          latency_ms: 6820,
          ok: true,
        },
        {
          id: 3,
          model: "meta/muse-spark-1.2",
          agent: "redteam",
          tokens_in: 640,
          tokens_out: 0,
          latency_ms: 210,
          ok: false,
        },
      ],
    },
    {
      name: "api_keys",
      columns: [
        { name: "id", type: "number", pk: true },
        { name: "name", type: "text" },
        { name: "prefix", type: "text" },
        { name: "revoked", type: "bool" },
      ],
      rows: [
        { id: 1, name: "Laptop rafi", prefix: "sk-lolo-8f2a", revoked: false },
        { id: 2, name: "Cursor (test)", prefix: "sk-lolo-1c93", revoked: true },
      ],
    },
  ];
}

/** Must match `seed().project.name` in api.ts, so the panel opens populated. */
export const DEFAULT_PROJECT = "lolo-app";

export function seedData(): DataSpace {
  return { [DEFAULT_PROJECT]: seedTables() };
}

// ── Agent-created tables ──────────────────────────────────────────

/**
 * When a prompt is clearly about persistence, the agent provisions tables in
 * the project's data space alongside the files it writes. Same keyword
 * matching the file planner uses, kept honest by actually creating them.
 */
export function tablesForPrompt(prompt: string): Table[] {
  const p = prompt.toLowerCase();
  const match = (words: string[]) => words.some((w) => p.includes(w));

  // Most specific intent first. A prompt like "bikin database untuk keranjang"
  // mentions "database" but wants products, not the generic notes table.
  if (match(["keranjang", "cart", "checkout", "produk", "product", "toko", "store"])) {
    return [
      {
        name: "products",
        columns: [
          { name: "id", type: "number", pk: true },
          { name: "name", type: "text" },
          { name: "price", type: "number" },
          { name: "stock", type: "number" },
        ],
        rows: [
          { id: 1, name: "Kursi kayu jati", price: 1450000, stock: 12 },
          { id: 2, name: "Meja makan 6 kursi", price: 6800000, stock: 4 },
          { id: 3, name: "Rak buku A", price: 1250000, stock: 0 },
        ],
      },
    ];
  }

  if (match(["todo", "task", "tugas"])) {
    return [
      {
        name: "tasks",
        columns: [
          { name: "id", type: "number", pk: true },
          { name: "title", type: "text" },
          { name: "done", type: "bool" },
          { name: "due", type: "date" },
        ],
        rows: [
          { id: 1, title: "Rancang skema Postgres", done: true, due: "2026-09-30" },
          { id: 2, title: "Fase 1 - server Hono", done: false, due: "2026-10-04" },
        ],
      },
    ];
  }

  if (match(["catatan", "note", "notes"])) {
    return [
      {
        name: "notes",
        columns: [
          { name: "id", type: "number", pk: true },
          { name: "title", type: "text" },
          { name: "body", type: "text" },
          { name: "pinned", type: "bool" },
        ],
        rows: [
          { id: 1, title: "Rancangan gateway", body: "Pooling per tier.", pinned: true },
          { id: 2, title: "Audit magic link", body: "Cek TTL 15 menit.", pinned: false },
        ],
      },
    ];
  }

  // Generic persistence request with no domain signal.
  if (match(["database", "data", "tabel", "table", "schema", "sql"])) {
    return [
      {
        name: "records",
        columns: [
          { name: "id", type: "number", pk: true },
          { name: "label", type: "text" },
          { name: "value", type: "text" },
        ],
        rows: [
          { id: 1, label: "contoh satu", value: "1" },
          { id: 2, label: "contoh dua", value: "2" },
        ],
      },
    ];
  }

  return [];
}

/** Adds any table that isn't already present. Never overwrites. */
export function mergeTables(tables: Table[], incoming: Table[]): Table[] {
  const next = [...tables];
  for (const t of incoming) {
    if (next.some((x) => x.name === t.name)) continue;
    next.push({ ...t, columns: t.columns.map((c) => ({ ...c })), rows: [...t.rows] });
  }
  return next;
}

export function tablesFor(space: DataSpace, project: string): Table[] {
  // Defensive: a snapshot written before this field existed, or a project that
  // has never been opened, must read as empty rather than throwing.
  return space?.[project] ?? [];
}

function nextId(rows: Row[], key: string): number {
  return rows.reduce((max, r) => {
    const n = Number(r[key]);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0) + 1;
}

export function addRow(
  tables: Table[],
  table: string,
  values: Row,
): { tables: Table[]; row: Row } {
  const target = tables.find((t) => t.name === table);
  if (!target) throw new Error(`Unknown table: ${table}`);

  const row: Row = {};
  for (const col of target.columns) {
    row[col.name] = coerce(values[col.name] ?? null, col.type);
  }
  const pk = target.columns.find((c) => c.pk);
  if (pk) row[pk.name] = nextId(target.rows, pk.name);

  return {
    tables: tables.map((t) => (t.name === table ? { ...t, rows: [...t.rows, row] } : t)),
    row,
  };
}

export function updateRow(
  tables: Table[],
  table: string,
  pk: string,
  key: unknown,
  column: string,
  value: unknown,
): Table[] {
  return tables.map((t) => {
    if (t.name !== table) return t;
    const col = t.columns.find((c) => c.name === column);
    if (!col) return t;
    return {
      ...t,
      rows: t.rows.map((r) =>
        String(r[pk]) === String(key) ? { ...r, [column]: coerce(value, col.type) } : r,
      ),
    };
  });
}

export function deleteRow(
  tables: Table[],
  table: string,
  pk: string,
  key: unknown,
): Table[] {
  return tables.map((t) =>
    t.name === table
      ? { ...t, rows: t.rows.filter((r) => String(r[pk]) !== String(key)) }
      : t,
  );
}

export function createTable(
  tables: Table[],
  name: string,
  columns: Column[],
): Table[] {
  if (tables.some((t) => t.name === name)) {
    throw new Error(`Table already exists: ${name}`);
  }
  return [...tables, { name, columns, rows: [] }];
}

export function dropTable(tables: Table[], name: string): Table[] {
  return tables.filter((t) => t.name !== name);
}

// ── A very small SQL surface over the store ──────────────────────────────

/**
 * Supports the handful of statements a workspace console actually needs:
 * SELECT * FROM t [WHERE col = value], INSERT, UPDATE, DELETE, plus SHOW TABLES.
 * Returns both the result and the resulting store, so callers never have to
 * guess whether a statement mutated anything.
 */
export function applySql(
  tables: Table[],
  sql: string,
): { tables: Table[]; result: QueryResult } {
  const stmt = sql.trim().replace(/;$/, "");

  const show = /^show\s+tables$/i.exec(stmt);
  if (show) {
    return {
      tables,
      result: {
        columns: ["table", "columns", "rows"],
        rows: tables.map((t) => ({
          table: t.name,
          columns: t.columns.length,
          rows: t.rows.length,
        })),
        affected: 0,
      },
    };
  }

  const select =
    /^select\s+(.+?)\s+from\s+([a-z_][\w]*)(?:\s+where\s+(\w+)\s*(=|!=)\s*(.+))?$/i.exec(
      stmt,
    );
  if (select) {
    const [, projection, table, col, op, rawValue] = select;
    const target = tables.find((t) => t.name === table);
    if (!target) throw new Error(`Unknown table: ${table}`);

    const wanted =
      projection!.trim() === "*"
        ? target.columns.map((c) => c.name)
        : projection!.split(",").map((s) => s.trim());

    let rows = target.rows;
    if (col && rawValue !== undefined) {
      const value = coerce(rawValue.trim().replace(/^['"]|['"]$/g, ""), "text");
      rows = rows.filter((r) =>
        op === "!=" ? String(r[col]) !== String(value) : String(r[col]) === String(value),
      );
    }
    return {
      tables,
      result: {
        columns: wanted,
        rows: rows.map((r) => Object.fromEntries(wanted.map((c) => [c, r[c] ?? null]))),
        affected: rows.length,
      },
    };
  }

  const insert = /^insert\s+into\s+([a-z_][\w]*)\s*\(([^)]+)\)\s*values\s*\((.+)\)$/i.exec(stmt);
  if (insert) {
    const [, table, colList, valueList] = insert;
    const cols = colList!.split(",").map((s) => s.trim());
    const values = valueList!
      .split(",")
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
    const { tables: next, row } = addRow(
      tables,
      table!,
      Object.fromEntries(cols.map((c, i) => [c, values[i]])),
    );
    return { tables: next, result: { columns: [], rows: [row], affected: 1 } };
  }

  const update = /^update\s+([a-z_][\w]*)\s+set\s+(\w+)\s*=\s*(.+?)(\s+where\s+(\w+)\s*=\s*(.+))?$/i.exec(stmt);
  if (update) {
    const [, table, column, rawValue, , , rawKey] = update;
    const target = tables.find((t) => t.name === table);
    if (!target) throw new Error(`Unknown table: ${table}`);
    const pk = target.columns.find((c) => c.pk)?.name ?? target.columns[0]!.name;
    const matches = rawKey
      ? target.rows.filter(
          (r) => String(r[pk]) === String(rawKey.trim().replace(/^['"]|['"]$/g, "")),
        ).length
      : target.rows.length;
    return {
      tables: updateRow(
        tables,
        table!,
        pk,
        rawKey?.trim().replace(/^['"]|['"]$/g, ""),
        column!,
        rawValue!.trim().replace(/^['"]|['"]$/g, ""),
      ),
      result: { columns: [], rows: [], affected: matches },
    };
  }

  const del = /^delete\s+from\s+([a-z_][\w]*)(?:\s+where\s+(\w+)\s*=\s*(.+))?$/i.exec(stmt);
  if (del) {
    const [, table, , rawKey] = del;
    const target = tables.find((t) => t.name === table);
    if (!target) throw new Error(`Unknown table: ${table}`);
    const pk = target.columns.find((c) => c.pk)?.name ?? target.columns[0]!.name;
    const affected = rawKey
      ? target.rows.filter(
          (r) => String(r[pk]) === String(rawKey.trim().replace(/^['"]|['"]$/g, "")),
        ).length
      : target.rows.length;
    return {
      tables: rawKey
        ? deleteRow(tables, table!, pk, rawKey.trim().replace(/^['"]|['"]$/g, ""))
        : dropTable(tables, table!),
      result: { columns: [], rows: [], affected },
    };
  }

  return {
    tables,
    result: {
      columns: [],
      rows: [],
      affected: 0,
      note: "Didn't understand that statement. Supported: SHOW TABLES, SELECT … FROM … [WHERE col = val], INSERT INTO … (cols) VALUES (…), UPDATE … SET col = val [WHERE pk = val], DELETE FROM … [WHERE pk = val].",
    },
  };
}
