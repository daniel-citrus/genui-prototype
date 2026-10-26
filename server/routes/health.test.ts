import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { healthRouter, type HealthOptions } from "./health";

async function health(opts: HealthOptions) {
  const app = Fastify();
  app.register(healthRouter, { prefix: "/api/health", ...opts });
  const res = await app.inject({ method: "GET", url: "/api/health" });
  await app.close();
  return res.json();
}

describe("GET /api/health", () => {
  it("reports db false without pingDb", async () => {
    assert.equal((await health({})).db, false);
  });

  it("reports the db ping result", async () => {
    assert.equal((await health({ pingDb: async () => true })).db, true);
    assert.equal((await health({ pingDb: async () => false })).db, false);
  });

  it("reports db false when the ping throws", async () => {
    const body = await health({
      pingDb: async () => {
        throw new Error("down");
      },
    });
    assert.equal(body.db, false);
    assert.equal(body.ok, true);
  });
});
