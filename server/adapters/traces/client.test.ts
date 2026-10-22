import assert from "node:assert/strict";
import { it } from "node:test";
import { assertDistinctTraceDatabase } from "../../config";
import { createTracesDb } from "./client";
import { runMigrations } from "./migrate";

const catalogUrl = "postgres://genui:genui@localhost:5432/genui";

it("assertDistinctTraceDatabase refuses when catalog and traces URLs name the same database", () => {
  assert.throws(
    () =>
      assertDistinctTraceDatabase(
        "postgres://genui:genui@localhost:5432/genui",
        "postgres://genui:genui@localhost:5432/genui",
      ),
    /must name different databases/,
  );
});

it("createTracesDb refuses when the traces URL names the same database as the catalog URL", () => {
  assert.throws(
    () => createTracesDb(catalogUrl, catalogUrl),
    /must name different databases/,
  );
});

it("runMigrations refuses when the traces URL names the same database as the catalog URL", async () => {
  const handle = createTracesDb(
    "postgres://genui:genui@127.0.0.1:1/genui_traces",
    catalogUrl,
  );
  assert.throws(
    () => runMigrations(handle.db, catalogUrl, catalogUrl),
    /must name different databases/,
  );
  await handle.close();
});

it("createTracesDb does not connect, and ping resolves false when Postgres is down", async () => {
  const handle = createTracesDb(
    "postgres://genui:genui@127.0.0.1:1/genui_traces",
    catalogUrl,
  );
  assert.equal(handle.pool.totalCount, 0);
  assert.equal(await handle.ping(), false);
  await handle.close();
});
