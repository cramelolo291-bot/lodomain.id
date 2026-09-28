// One connection pool for the process, one Drizzle instance. Imported by
// everything; never constructed anywhere else.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import { schema } from "./schema";

/**
 * `prepare: false` is required for pgbouncer in transaction mode, which is
 * what most managed Postgres puts in front. Without it every query fails
 * under load with "prepared statement does not exist".
 */
export const pool = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
  onnotice: () => {},
});

export const db = drizzle(pool, { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function ping(): Promise<boolean> {
  try {
    await pool`select 1`;
    return true;
  } catch {
    return false;
  }
}

export async function close(): Promise<void> {
  await pool.end({ timeout: 5 });
}
