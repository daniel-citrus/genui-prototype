import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { generate } from "./generateClient";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function reply(status: number, body: unknown) {
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status });
}

describe("generate", () => {
  it("posts the prompt and returns the design", async () => {
    const sent: Array<{ url: string; init?: RequestInit }> = [];
    const tree = { type: "Text", props: { content: "hi" } };
    globalThis.fetch = async (input, init) => {
      sent.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true, id: "d1", tree, notes: "n", attempts: 1 }), { status: 200 });
    };
    const out = await generate({ prompt: "a form" });
    assert.equal(sent[0].url, "/api/generate");
    assert.equal(sent[0].init?.method, "POST");
    assert.deepEqual(JSON.parse(String(sent[0].init?.body)), { prompt: "a form" });
    assert.equal(out.kind, "ok");
    if (out.kind === "ok") assert.equal(out.design.id, "d1");
  });

  it("reports a 422 as invalid with its problems", async () => {
    reply(422, { ok: false, error: "bad", problems: ["p1"], attempts: 3 });
    assert.deepEqual(await generate({ prompt: "x" }), { kind: "invalid", problems: ["p1"] });
  });

  it("shows the API's message for other HTTP errors", async () => {
    reply(503, { error: { message: "Generation is not configured." } });
    assert.deepEqual(await generate({ prompt: "x" }), { kind: "error", message: "Generation is not configured." });
  });

  it("shows a rate-limit body's message", async () => {
    reply(429, { message: "Too many requests" });
    assert.deepEqual(await generate({ prompt: "x" }), { kind: "error", message: "Too many requests" });
  });

  it("falls back to the status when the body has no message", async () => {
    globalThis.fetch = async () => new Response("oops", { status: 500 });
    assert.deepEqual(await generate({ prompt: "x" }), { kind: "error", message: "Request failed (500)" });
  });

  it("resolves to an error when fetch rejects", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("network down");
    };
    assert.deepEqual(await generate({ prompt: "x" }), { kind: "error", message: "Couldn't reach the server." });
  });
});
