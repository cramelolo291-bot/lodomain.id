// SQL console for the data space.
//
// The parser itself is shared with the browser preview (`src/lib/data.ts`) so
// the two surfaces cannot drift: a statement that works in one works in the
// other. This wrapper only preserves the extra `id` field the server needs to
// write changes back, which the shared type does not know about.

import { applySql as parse, type QueryResult, type Row, type Table } from "../../src/lib/data";

export type ServerTable = Table & { id?: string };

export type { QueryResult, Row, Table };

export function applySql(
  tables: ServerTable[],
  sql: string,
): { tables: ServerTable[]; result: QueryResult } {
  return parse(tables as Table[], sql) as {
    tables: ServerTable[];
    result: QueryResult;
  };
}
