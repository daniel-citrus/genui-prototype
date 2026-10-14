import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyToolRegistry } from "./agent/tools";
import type { AgentLlm } from "./ports/AgentLlm";
import { buildApp } from "./app";

const llm: AgentLlm = {
  async complete() {
    return { content: "ok", toolCalls: [] };
  },
};

const build = () => buildApp({ llm, tools: emptyToolRegistry, pingDb: async () => true });

describe("buildApp", () => {
  it("answers health with the db result", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.db, true);
    assert.equal(typeof body.agent, "boolean");
    await app.close();
  });

  it("accepts an empty JSON body and rejects it as a bad request", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { "content-type": "application/json" },
      payload: "",
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.message, "conversationId and message are required");
    await app.close();
  });

  it("returns a 4xx JSON error for malformed JSON", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    assert.ok(res.statusCode >= 400 && res.statusCode < 500);
    assert.equal(typeof res.json().error.message, "string");
    await app.close();
  });

  it("hides the message of an unexpected error", async () => {
    const app = await build();
    app.get("/boom", async () => {
      throw new Error("secret detail");
    });
    const res = await app.inject({ method: "GET", url: "/boom" });
    assert.equal(res.statusCode, 500);
    assert.equal(res.json().error.message, "Internal server error");
    await app.close();
  });

  it("answers 413 with a JSON error for a chat body over 32 KB", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: { conversationId: "c", message: "a".repeat(33 * 1024) },
    });
    assert.equal(res.statusCode, 413);
    assert.equal(typeof res.json().error.message, "string");
    await app.close();
  });

  it("accepts 4,000 characters of 4-byte UTF-8 under the body limit", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: { conversationId: "c", message: "\u{1F600}".repeat(2000) },
    });
    assert.equal(res.statusCode, 200);
    await app.close();
  });

  it("answers 400 with a JSON error for an over-long message", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: { conversationId: "c", message: "a".repeat(4001) },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.message, "Message is too long (max 4000 characters).");
    await app.close();
  });
});
