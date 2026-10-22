import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { assertDistinctTraceDatabase } from "../../config";
import * as schema from "./schema";

export type TracesDb = NodePgDatabase<typeof schema>;

export interface TracesDbHandle {
  db: TracesDb;
  pool: pg.Pool;
  /** Resolves whether Postgres answered `select 1`; never rejects. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

/** Builds the pool and Drizzle client. Nothing connects until the first query. */
export function createTracesDb(
  tracesDatabaseUrl: string,
  catalogDatabaseUrl: string,
): TracesDbHandle {
  assertDistinctTraceDatabase(catalogDatabaseUrl, tracesDatabaseUrl);
  const pool = new pg.Pool({ connectionString: tracesDatabaseUrl });
  pool.on("error", () => {});
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    async ping() {
      try {
        await db.execute(sql`select 1`);
        return true;
      } catch {
        return false;
      }
    },
    close: () => pool.end(),
  };
}
