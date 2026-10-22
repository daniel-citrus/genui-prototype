import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  deleteCustomComponent,
  getCustomComponent,
  listCustomComponents,
  restoreCustomComponent,
  revertCustomComponent,
} from "./customComponentsClient";

interface Sent {
  url: string;
  method?: string;
  body?: unknown;
  contentType?: string | null;
}

const realFetch = globalThis.fetch;
let sent: Sent[] = [];

/** Replaces `fetch` with one that records each request and answers `status` with `body`. */
function stubFetch(status: number, body?: unknown) {
  sent = [];
  globalThis.fetch = async (input, init) => {
    sent.push({
      url: String(input),
      method: init?.method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
      contentType: new Headers(init?.headers).get("content-type"),
    });
    const text = typeof body === "string" ? body : body === undefined ? null : JSON.stringify(body);
    return new Response(text, { status });
  };
}

describe("customComponentsClient", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("lists components with GET /api/custom-components", async () => {
    stubFetch(200, { components: [] });
    assert.deepEqual(await listCustomComponents(), { components: [] });
    assert.deepEqual(sent, [{ url: "/api/custom-components", method: "GET", body: undefined, contentType: null }]);
  });

  it("reads one component with GET /api/custom-components/:name", async () => {
    const detail = { component: { name: "MenuCard" }, versions: [], preview: null, previewErrors: [] };
    stubFetch(200, detail);
    assert.deepEqual(await getCustomComponent("MenuCard"), detail);
    assert.equal(sent[0].url, "/api/custom-components/MenuCard");
    assert.equal(sent[0].method, "GET");
  });

  it("deletes with DELETE and restores with POST …/restore, resolving undefined for 204", async () => {
    stubFetch(204);
    assert.equal(await deleteCustomComponent("MenuCard"), undefined);
    assert.equal(sent[0].url, "/api/custom-components/MenuCard");
    assert.equal(sent[0].method, "DELETE");

    stubFetch(204);
    assert.equal(await restoreCustomComponent("MenuCard"), undefined);
    assert.equal(sent[0].url, "/api/custom-components/MenuCard/restore");
    assert.equal(sent[0].method, "POST");
    assert.equal(sent[0].body, undefined);
  });

  it("reverts with POST …/revert and a JSON { version } body", async () => {
    stubFetch(200, { version: 4 });
    assert.deepEqual(await revertCustomComponent("MenuCard", 2), { version: 4 });
    assert.deepEqual(sent, [
      {
        url: "/api/custom-components/MenuCard/revert",
        method: "POST",
        body: { version: 2 },
        contentType: "application/json",
      },
    ]);
  });

  it("throws the route's message", async () => {
    stubFetch(409, { error: { message: '"MenuCard" already has the limit of 20 versions.' } });
    await assert.rejects(revertCustomComponent("MenuCard", 1), {
      message: '"MenuCard" already has the limit of 20 versions.',
    });

    stubFetch(429, { statusCode: 429, message: "Too many messages. Try again in 5 seconds." });
    await assert.rejects(listCustomComponents(), { message: "Too many messages. Try again in 5 seconds." });
  });

  it("throws a generic message for a body without one or an unreachable server", async () => {
    stubFetch(502, "<html>Bad gateway</html>");
    await assert.rejects(deleteCustomComponent("MenuCard"), { message: "Request failed (502)" });

    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    await assert.rejects(restoreCustomComponent("MenuCard"), { message: "Couldn't reach the server." });
  });
});
