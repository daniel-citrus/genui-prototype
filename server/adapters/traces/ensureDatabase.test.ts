import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import pg from "pg";
import { createDb, type DbHandle } from "../db/client";
import { ensureTracesDatabase, TRACES_DATABASE_NAME } from "./ensureDatabase";

const catalogDatabaseUrl = process.env.DATABASE_URL;

describe(
  "ensureTracesDatabase",
  { skip: catalogDatabaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    let catalog: DbHandle;

    after(async () => {
      await catalog?.close();
    });

    it("creates genui_traces without dropping genui and is idempotent", async () => {
      catalog = createDb(catalogDatabaseUrl!);
      assert.equal(await catalog.ping(), true);

      await ensureTracesDatabase(catalogDatabaseUrl!);
      await ensureTracesDatabase(catalogDatabaseUrl!);

      const admin = new pg.Pool({ connectionString: catalogDatabaseUrl });
      try {
        const genui = await admin.query("select 1 from pg_database where datname = 'genui'");
        assert.equal(genui.rowCount, 1);
        const traces = await admin.query("select 1 from pg_database where datname = $1", [
          TRACES_DATABASE_NAME,
        ]);
        assert.equal(traces.rowCount, 1);
      } finally {
        await admin.end();
      }
    });
  },
);
