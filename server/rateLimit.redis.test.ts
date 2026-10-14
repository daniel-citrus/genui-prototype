import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, describe, it } from "node:test";
import { createRedis } from "./adapters/redis/client";
import { emptyToolRegistry } from "./agent/tools";
import { buildApp } from "./app";
import type { AgentLlm } from "./ports/AgentLlm";

const url = process.env.REDIS_URL;
const WINDOW_MS = 60_000;

const llm: AgentLlm = {
  async complete() {
    return { content: "ok", toolCalls: [] };
  },
};

describe("chat rate limit in Redis", { skip: !url }, () => {
  const nameSpace = `test-rate-limit-${randomBytes(6).toString("hex")}:`;
  const handles = [createRedis(url!, { warn: () => {}, info: () => {} })];
  const build = async () => {
    const redis = createRedis(url!, { warn: () => {}, info: () => {} });
    handles.push(redis);
    // Commands fail fast until connected (no offline queue), so wait for it.
    while (!(await redis.ping())) await new Promise((r) => setTimeout(r, 20));
    return buildApp({ llm, tools: emptyToolRegistry, rateLimit: { max: 20, nameSpace }, redis });
  };
  // Fails validation (400) without reaching the model; still counts toward the limit.
  const chat = (app: Awaited<ReturnType<typeof build>>, remoteAddress: string) =>
    app.inject({ method: "POST", url: "/api/agent/chat", payload: {}, remoteAddress });

  after(async () => {
    const [admin] = handles;
    const keys = await admin.client.keys(`${nameSpace}*`);
    if (keys.length) await admin.client.del(...keys);
    await Promise.all(handles.map((h) => h.close()));
  });

  it("limits per IP", async () => {
    const app = await build();
    for (let i = 0; i < 20; i++) assert.equal((await chat(app, "10.0.1.1")).statusCode, 400);
    const res = await chat(app, "10.0.1.1");
    assert.equal(res.statusCode, 429);
    assert.ok(res.headers["retry-after"]);
    assert.match(res.json().message ?? res.json().error?.message, /^Too many messages/);
    assert.equal((await chat(app, "10.0.1.2")).statusCode, 400);
    await app.close();
  });

  it("keeps counts across app instances, under the namespace with a TTL", async () => {
    const ip = "10.0.2.1";
    const first = await build();
    for (let i = 0; i < 20; i++) await chat(first, ip);
    await first.close();

    const second = await build();
    assert.equal((await chat(second, ip)).statusCode, 429);
    await second.close();

    const keys = await handles[0].client.keys(`${nameSpace}*`);
    assert.ok(keys.length > 0);
    for (const key of keys) {
      const ttl = await handles[0].client.pttl(key);
      assert.ok(ttl > 0 && ttl <= WINDOW_MS, `ttl ${ttl}`);
    }
  });
});
