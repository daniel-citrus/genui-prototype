import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { forgetChat } from "./agentClient";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("forgetChat", () => {
  it("sends DELETE with no body to the encoded path", async () => {
    const sent: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
      sent.push({ url: String(input), init });
      return new Response(null, { status: 204 });
    };
    await forgetChat("a b/c");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, "/api/agent/conversations/a%20b%2Fc");
    assert.equal(sent[0].init?.method, "DELETE");
    assert.equal(sent[0].init?.body, undefined);
  });

  it("resolves when fetch rejects", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("network down");
    };
    await assert.doesNotReject(forgetChat("x"));
  });

  it("resolves on 429", async () => {
    globalThis.fetch = async () => new Response("slow down", { status: 429 });
    await assert.doesNotReject(forgetChat("x"));
  });
});
