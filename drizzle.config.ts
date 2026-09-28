// Drizzle Kit, for `bun run db:studio` and for generating SQL during schema work.
//
// The committed migrations under `server/db/migrations` are the source of
// truth. This config exists so the schema can be inspected against a live
// database; do not use `drizzle-kit push` to apply changes, because that
// bypasses review and leaves no rollback path.

import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "postgres://lolo:lolo@127.0.0.1:5432/lolo";

export default defineConfig({
  schema: "./server/db/schema.ts",
  out: "./server/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
