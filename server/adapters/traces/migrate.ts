import { migrate } from "drizzle-orm/node-postgres/migrator";
import { assertDistinctTraceDatabase } from "../../config";
import type { TracesDb } from "./client";

/** Applies pending migrations. The folder is relative to the working directory. */
export function runMigrations(
  db: TracesDb,
  catalogDatabaseUrl: string,
  tracesDatabaseUrl: string,
  migrationsFolder = "server/adapters/traces/migrations",
): Promise<void> {
  assertDistinctTraceDatabase(catalogDatabaseUrl, tracesDatabaseUrl);
  return migrate(db, { migrationsFolder });
}
