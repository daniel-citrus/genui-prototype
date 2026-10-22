import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyToolRegistry } from "../../agent/tools";
import { InMemoryTraceRepository } from "../../ports/fakes/InMemoryTraceRepository";
import { buildApp } from "../../app";
import type { AgentLlm } from "../../ports/AgentLlm";
import { createRedis } from "./client";

// Nothing listens on port 1.
const DEAD_URL = "redis://user:s3cretpw@127.0.0.1:1";

const llm: AgentLlm = {
  async complete() {
    return { content: "ok", toolCalls: [] };
  },
};

describe("redis client with Redis down", () => {
  it("pings false, warns once without credentials, and closes while disconnected", async () => {
    const warnings: string[] = [];
    const redis = createRedis(DEAD_URL, { warn: (m) => warnings.push(m), info: () => {} });
    assert.equal(await redis.ping(), false);
    assert.equal(await redis.ping(), false);
    await new Promise((r) => setTimeout(r, 1500)); // several reconnect attempts
    assert.equal(warnings.length, 1);
    assert.ok(!warnings[0].includes("s3cretpw"));
    assert.ok(warnings[0].includes("127.0.0.1:1"));
    await redis.close();
  });

  it("lets a chat request through quickly", async () => {
    const redis = createRedis(DEAD_URL, { warn: () => {}, info: () => {} });
    const app = await buildApp({
      llm,
      tools: emptyToolRegistry,
      rateLimit: { max: 5 },
      redis,
      traces: new InMemoryTraceRepository(),
    });
    const started = Date.now();
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: { conversationId: "c1", message: "hi" },
    });
    assert.equal(res.statusCode, 200);
    assert.ok(Date.now() - started < 1000);
    await app.close(); // closes the redis handle too
  });
});
