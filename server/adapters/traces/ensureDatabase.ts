import pg from "pg";

export const TRACES_DATABASE_NAME = "genui_traces";

/** Creates the traces database on the same instance as the catalog URL when missing. */
export async function ensureTracesDatabase(catalogDatabaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: catalogDatabaseUrl });
  pool.on("error", () => {});
  try {
    const client = await pool.connect();
    try {
      const existing = await client.query("select 1 from pg_database where datname = $1", [
        TRACES_DATABASE_NAME,
      ]);
      if (existing.rowCount === 0) {
        await client.query(`create database ${TRACES_DATABASE_NAME}`);
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
