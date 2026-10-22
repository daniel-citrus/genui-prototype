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
  it("reports redis null without pingRedis", async () => {
    assert.equal((await health({})).redis, null);
  });

  it("reports the redis ping result", async () => {
    assert.equal((await health({ pingRedis: async () => true })).redis, true);
    assert.equal((await health({ pingRedis: async () => false })).redis, false);
  });

  it("reports redis false when the ping throws", async () => {
    const body = await health({
      pingRedis: async () => {
        throw new Error("down");
      },
    });
    assert.equal(body.redis, false);
    assert.equal(body.ok, true);
  });

  it("reports traces false without pingTraces", async () => {
    assert.equal((await health({})).traces, false);
  });

  it("reports the traces ping result", async () => {
    assert.equal((await health({ pingTraces: async () => true })).traces, true);
    assert.equal((await health({ pingTraces: async () => false })).traces, false);
  });

  it("reports traces false when the ping throws", async () => {
    const body = await health({
      pingTraces: async () => {
        throw new Error("down");
      },
    });
    assert.equal(body.traces, false);
    assert.equal(body.ok, true);
  });
});
