// The per-project data space, rendered.
//
// Tables on the left, rows in the middle, schema inspector on the right.
// Every cell is editable in place, rows can be added and deleted, and there is
// a SQL console for anything the grid can't express. Nothing is capped.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Braces,
  Columns3,
  Database,
  Plus,
  Rows3,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import type { Column, QueryResult, Row, Table } from "../lib/data";
import type { ColumnType } from "../lib/data";

const TYPE_HINT: Record<ColumnType, string> = {
  text: "text",
  number: "number",
  bool: "true/false",
  date: "date",
};

function cellText(value: Row[string]): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function DataPanel({ project }: { project: string }) {
  const [tables, setTables] = useState<Table[]>([]);
  const [active, setActive] = useState<string>("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [showSchema, setShowSchema] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [newTable, setNewTable] = useState<string | null>(null);

  async function refresh() {
    try {
      const list = await api.dataTables(project);
      setTables(list);
      setActive((current) =>
        list.some((t) => t.name === current) ? current : (list[0]?.name ?? ""),
      );
      setError(null);
    } catch (e) {
      // A failed read must degrade to an empty panel, not an unhandled
      // rejection that blanks the workspace.
      setTables([]);
      setActive("");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const table = useMemo(
    () => tables.find((t) => t.name === active) ?? null,
    [tables, active],
  );

  const pk = table?.columns.find((c) => c.pk)?.name;

  const visibleRows = useMemo(() => {
    if (!table) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return table.rows;
    return table.rows.filter((r) =>
      table.columns.some((c) => cellText(r[c.name]).toLowerCase().includes(q)),
    );
  }, [table, filter]);

  const totalRows = tables.reduce((n, t) => n + t.rows.length, 0);
  const totalCells = tables.reduce(
    (n, t) => n + t.rows.length * t.columns.length,
    0,
  );

  async function run(sql: string) {
    setError(null);
    try {
      const r = await api.dataQuery(project, sql);
      setResult(r);
      if (r.note) setError(r.note);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function addRow() {
    if (!table) return;
    await api.dataAddRow(
      project,
      table.name,
      Object.fromEntries(table.columns.map((c) => [c.name, null])),
    );
    await refresh();
  }

  async function editCell(column: string, key: unknown, value: string) {
    if (!table || !pk) return;
    await api.dataUpdateRow(project, table.name, pk, String(key), column, value);
    await refresh();
  }

  async function removeRow(key: unknown) {
    if (!table || !pk) return;
    await api.dataDeleteRow(project, table.name, pk, String(key));
    await refresh();
  }

  async function createTable(name: string) {
    setError(null);
    try {
      await api.dataCreateTable(project, name, [
        { name: "id", type: "number", pk: true },
        { name: "name", type: "text" },
        { name: "created_at", type: "date" },
      ]);
      setNewTable(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function dropTable(name: string) {
    await api.dataDropTable(project, name);
    await refresh();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-text">
          <Database size={13} className="text-accent" />
          {project}
        </span>
        <span className="font-mono text-[11px] text-muted">
          {tables.length} tables · {totalRows} rows · {totalCells} cells
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Toggle active={showSchema} onClick={() => setShowSchema((v) => !v)} label="Schema" icon={<Columns3 size={12} />} />
          <Toggle active={showSql} onClick={() => setShowSql((v) => !v)} label="SQL" icon={<Braces size={12} />} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Table list */}
        <div className="flex w-[180px] shrink-0 flex-col border-r border-border">
          <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-[0.09em] text-muted">
            Tables
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
            {tables.map((t) => (
              <div key={t.name} className="group relative">
                <button
                  type="button"
                  onClick={() => setActive(t.name)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors ${
                    active === t.name
                      ? "bg-surface-3 text-text"
                      : "text-muted hover:bg-surface-2 hover:text-text"
                  }`}
                >
                  <Rows3 size={12} className="shrink-0" />
                  <span className="truncate font-mono">{t.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-faint">
                    {t.rows.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void dropTable(t.name)}
                  title={`Drop ${t.name}`}
                  className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded p-1 text-faint hover:text-danger group-hover:block"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}

            {newTable === null ? (
              <button
                type="button"
                onClick={() => setNewTable("")}
                className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                <Plus size={12} /> New table
              </button>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newTable.trim()) void createTable(newTable.trim());
                }}
                className="mt-1 px-1"
              >
                <input
                  autoFocus
                  value={newTable}
                  onChange={(e) => setNewTable(e.target.value)}
                  placeholder="table name"
                  className="w-full rounded-md border border-border bg-surface-1 px-2 py-1 font-mono text-[12px] text-text outline-none focus:border-accent"
                />
                <div className="mt-1 flex gap-1">
                  <button
                    type="submit"
                    className="flex-1 rounded bg-accent px-1.5 py-1 text-[11px] font-medium text-white"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewTable(null)}
                    className="rounded px-1.5 py-1 text-[11px] text-muted hover:text-text"
                  >
                    <X size={11} />
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Grid */}
        <div className="flex min-w-0 flex-1 flex-col">
          {table ? (
            <>
              <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2">
                <span className="font-mono text-[12px] font-medium text-text">
                  {table.name}
                </span>
                <span className="font-mono text-[11px] text-muted">
                  {table.rows.length} {table.rows.length === 1 ? "row" : "rows"}
                </span>
                <div className="relative ml-auto">
                  <Search
                    size={12}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-faint"
                  />
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter rows"
                    className="w-[160px] rounded-md border border-border bg-surface-1 py-1 pl-7 pr-2 text-[12px] text-text outline-none placeholder:text-faint focus:border-accent"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void addRow()}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-text transition-colors hover:border-accent hover:text-accent"
                >
                  <Plus size={12} /> Row
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead className="sticky top-0 z-10 bg-surface-2">
                    <tr>
                      {table.columns.map((c) => (
                        <th
                          key={c.name}
                          className="border-b border-border px-3 py-2 text-left font-medium text-muted"
                        >
                          <span className="font-mono">{c.name}</span>
                          {c.pk && (
                            <span className="ml-1.5 text-[9px] uppercase tracking-wider text-faint">
                              pk
                            </span>
                          )}
                          <span className="ml-1.5 text-[9px] uppercase tracking-wider text-faint">
                            {c.type}
                          </span>
                        </th>
                      ))}
                      <th className="w-9 border-b border-border" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, i) => (
                      <tr
                        key={cellText(row[pk ?? "id"]) || i}
                        className="group border-b border-border/60 transition-colors hover:bg-surface-2"
                      >
                        {table.columns.map((c) => (
                          <td key={c.name} className="px-0 py-0">
                            <input
                              value={cellText(row[c.name])}
                              onChange={(e) =>
                                void editCell(c.name, row[pk ?? "id"], e.target.value)
                              }
                              className="w-full bg-transparent px-3 py-1.5 font-mono text-text outline-none focus:bg-surface-3 focus:ring-1 focus:ring-inset focus:ring-accent"
                            />
                          </td>
                        ))}
                        <td className="px-0">
                          <button
                            type="button"
                            onClick={() => void removeRow(row[pk ?? "id"])}
                            title="Delete row"
                            className="rounded p-1.5 text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {visibleRows.length === 0 && (
                  <p className="px-4 py-10 text-center text-[13px] text-muted">
                    {table.rows.length === 0
                      ? "Empty table. Use + Row to add the first record."
                      : `No rows match "${filter}".`}
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="flex flex-1 items-center justify-center text-[13px] text-muted">
              No tables yet.
            </p>
          )}
        </div>

        {/* Schema inspector */}
        {showSchema && table && (
          <div className="w-[210px] shrink-0 overflow-y-auto border-l border-border px-3 py-3">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.09em] text-muted">
              Schema · {table.name}
            </div>
            {table.columns.map((c: Column) => (
              <div
                key={c.name}
                className="mb-1.5 rounded-md border border-border bg-surface-1 px-2.5 py-2"
              >
                <div className="font-mono text-[12px] text-text">{c.name}</div>
                <div className="mt-0.5 font-mono text-[10px] text-muted">
                  {c.type} · {TYPE_HINT[c.type]}
                  {c.pk && " · primary key"}
                </div>
              </div>
            ))}
            <div className="mt-3 rounded-md border border-border bg-surface-1 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-muted">
              create table {table.name} (<br />
              {table.columns.map((c, i) => (
                <span key={c.name}>
                  {'  '}
                  {c.name} {c.type}
                  {c.pk && " primary key"}
                  {i < table.columns.length - 1 ? "," : ""}
                  <br />
                </span>
              ))}
              );
            </div>
          </div>
        )}
      </div>

      {/* SQL console */}
      {showSql && (
        <div className="shrink-0 border-t border-border bg-surface-1">
          <div className="flex items-center gap-2 px-3 py-1.5">
            <Braces size={12} className="text-accent" />
            <span className="text-[11px] font-medium text-text">SQL console</span>
            <span className="font-mono text-[10px] text-faint">
              SHOW TABLES · SELECT · INSERT · UPDATE · DELETE
            </span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(query);
            }}
            className="flex gap-2 px-3 pb-2"
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="SELECT * FROM usage_events WHERE ok = true"
              className="flex-1 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-text outline-none placeholder:text-faint focus:border-accent"
            />
            <button
              type="submit"
              className="rounded-md bg-accent px-3 text-[12px] font-medium text-white"
            >
              Run
            </button>
          </form>

          {result && (
            <div className="max-h-[180px] overflow-auto border-t border-border px-3 py-2">
              {result.note ? (
                <p className="text-[11px] text-muted">{result.note}</p>
              ) : result.rows.length ? (
                <>
                  <p className="mb-1.5 font-mono text-[10px] text-faint">
                    {result.affected} {result.affected === 1 ? "row" : "rows"}
                  </p>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr>
                        {result.columns.map((c) => (
                          <th
                            key={c}
                            className="border-b border-border px-2 py-1 text-left font-mono font-medium text-muted"
                          >
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((r, i) => (
                        <tr key={i}>
                          {result.columns.map((c) => (
                            <td
                              key={c}
                              className="px-2 py-1 font-mono text-text"
                            >
                              {cellText(r[c])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <p className="font-mono text-[11px] text-muted">
                  {result.affected} {result.affected === 1 ? "row" : "rows"} affected.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="shrink-0 border-t border-border px-3 py-2 text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function Toggle({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors ${
        active
          ? "border-accent bg-surface-3 text-accent"
          : "border-border text-muted hover:text-text"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
