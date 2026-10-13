import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  /** Resolves whether Postgres answered `select 1`; never rejects. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

/** Builds the pool and Drizzle client. Nothing connects until the first query. */
export function createDb(databaseUrl: string): DbHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  // An idle client losing its connection must not crash the process.
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
