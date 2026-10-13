import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client";

/** Applies pending migrations. The folder is relative to the working directory. */
export function runMigrations(
  db: Db,
  migrationsFolder = "server/adapters/db/migrations",
): Promise<void> {
  return migrate(db, { migrationsFolder });
}
