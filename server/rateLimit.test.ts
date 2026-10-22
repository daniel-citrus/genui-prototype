import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyToolRegistry } from "./agent/tools";
import { InMemoryTraceRepository } from "./ports/fakes/InMemoryTraceRepository";
import { buildApp } from "./app";
import { parseTrustProxy } from "./config";
import type { AgentLlm } from "./ports/AgentLlm";
import { tooManyMessages } from "./rateLimit";

const llm: AgentLlm = {
  async complete() {
    return { content: "ok", toolCalls: [] };
  },
};

const build = (max: number, trustProxy?: number | false) =>
  buildApp({
    llm,
    tools: emptyToolRegistry,
    pingDb: async () => true,
    rateLimit: { max },
    trustProxy,
    traces: new InMemoryTraceRepository(),
  });

// Fails validation (400) without reaching the model; still counts toward the limit.
const chat = (app: Awaited<ReturnType<typeof build>>, remoteAddress: string, headers = {}) =>
  app.inject({ method: "POST", url: "/api/agent/chat", payload: {}, remoteAddress, headers });

describe("chat rate limit", () => {
  it("refuses the request after max, with a retry-after and message", async () => {
    const app = await build(20);
    for (let i = 0; i < 20; i++) {
      assert.equal((await chat(app, "10.0.0.1")).statusCode, 400);
    }
    const res = await chat(app, "10.0.0.1");
    assert.equal(res.statusCode, 429);
    const match = /^Too many messages\. Try again in (\d+) seconds?\.$/.exec(res.json().error.message);
    assert.ok(match);
    assert.equal(match[1], res.headers["retry-after"]);
    assert.equal((await chat(app, "10.0.0.2")).statusCode, 400);
    assert.equal((await app.inject({ method: "GET", url: "/api/health" })).statusCode, 200);
    await app.close();
  });

  it("honors a custom max", async () => {
    const app = await build(2);
    await chat(app, "10.0.0.1");
    await chat(app, "10.0.0.1");
    assert.equal((await chat(app, "10.0.0.1")).statusCode, 429);
    await app.close();
  });

  it("ignores x-forwarded-for without trustProxy", async () => {
    const app = await build(1);
    await chat(app, "10.0.0.1", { "x-forwarded-for": "1.1.1.1" });
    const res = await chat(app, "10.0.0.1", { "x-forwarded-for": "2.2.2.2" });
    assert.equal(res.statusCode, 429);
    await app.close();
  });

  it("separates clients by x-forwarded-for with trustProxy 1", async () => {
    const app = await build(1, 1);
    await chat(app, "10.0.0.1", { "x-forwarded-for": "1.1.1.1" });
    assert.equal((await chat(app, "10.0.0.1", { "x-forwarded-for": "2.2.2.2" })).statusCode, 400);
    assert.equal((await chat(app, "10.0.0.1", { "x-forwarded-for": "1.1.1.1" })).statusCode, 429);
    await app.close();
  });
});

describe("tooManyMessages", () => {
  it("rounds up to whole seconds, minimum 1", () => {
    assert.equal(tooManyMessages(34000), "Too many messages. Try again in 34 seconds.");
    assert.equal(tooManyMessages(1), "Too many messages. Try again in 1 second.");
    assert.equal(tooManyMessages(0), "Too many messages. Try again in 1 second.");
  });
});

describe("parseTrustProxy", () => {
  it("accepts only a positive integer", () => {
    for (const v of [undefined, "0", "abc", "true"]) assert.equal(parseTrustProxy(v), false);
    assert.equal(parseTrustProxy("1"), 1);
  });
});
