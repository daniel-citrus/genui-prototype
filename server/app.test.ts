import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildApp } from "./app";

const build = () =>
  buildApp({
    rateLimit: { max: 1000 },
    pingDb: async () => true,
  });

describe("buildApp", () => {
  it("answers health with the db result", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(Object.keys(body).sort(), ["agent", "db", "ok"]);
    assert.equal(body.ok, true);
    assert.equal(body.db, true);
    assert.equal(typeof body.agent, "boolean");
    await app.close();
  });

  it("accepts an empty JSON body and rejects it as a bad request", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/api/generate",
      headers: { "content-type": "application/json" },
      payload: "",
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.message, "Expected a JSON object body.");
    await app.close();
  });

  it("returns a 4xx JSON error for malformed JSON", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/api/generate",
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

  it("answers 413 with a JSON error for a generate body over 32 KB", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/api/generate",
      payload: { prompt: "a".repeat(33 * 1024) },
    });
    assert.equal(res.statusCode, 413);
    assert.equal(typeof res.json().error.message, "string");
    await app.close();
  });

  it("answers 404 on the removed agent routes", async () => {
    const app = await build();
    for (const [method, url] of [
      ["POST", "/api/agent/chat"],
      ["DELETE", "/api/agent/conversations/c1"],
    ] as const) {
      assert.equal((await app.inject({ method, url, payload: method === "POST" ? {} : undefined })).statusCode, 404);
    }
    await app.close();
  });
});
