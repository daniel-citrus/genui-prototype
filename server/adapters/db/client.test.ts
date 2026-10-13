import assert from "node:assert/strict";
import { it } from "node:test";
import { createDb } from "./client";

it("createDb does not connect, and ping resolves false when Postgres is down", async () => {
  const handle = createDb("postgres://genui:genui@127.0.0.1:1/genui");
  assert.equal(handle.pool.totalCount, 0);
  assert.equal(await handle.ping(), false);
  await handle.close();
});
