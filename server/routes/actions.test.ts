import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { UiNode } from "shared/ui";
import { createActionRegistry } from "../actions/registry";
import { rememberDesign, resetConversation } from "../agent/conversations";
import { emptyToolRegistry } from "../agent/tools";
import { buildApp } from "../app";
import { DESIGN_GONE_MESSAGE } from "./actions";

const CONVERSATION = "actions-route-test";
const UI_ID = "design-1";

const design: UiNode = {
  component: "Card",
  children: [
    { component: "TextInput", props: { label: "Note", name: "note" } },
    { component: "TextInput", props: { label: "Search", name: "search" } },
    { component: "TextInput", props: { label: "PIN", name: "pin", type: "password" } },
    { component: "Select", props: { label: "Size", name: "size", options: ["S", "M"] } },
    { component: "Checkbox", props: { label: "Gift", name: "gift" } },
    { component: "Button", props: { label: "Save", action: "save_note" } },
    { component: "Button", props: { label: "Order", action: "order", disabled: true } },
  ],
};

/** Values each `save_note` run received. */
let received: Record<string, string | boolean>[] = [];

const actions = createActionRegistry([
  {
    name: "save_note",
    description: "Saves a note.",
    input_schema: {
      type: "object",
      properties: {
        note: { type: "string", maxLength: 5, description: "The note." },
        size: { type: "string", description: "Size." },
        gift: { type: "boolean", description: "Gift." },
      },
      additionalProperties: false,
    },
    async run(values) {
      received.push(values);
      return { ok: true, message: "Saved." };
    },
  },
  {
    name: "order",
    description: "Orders.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    async run() {
      return { ok: true, message: "Ordered." };
    },
  },
]);

const build = (opts: { max?: number; logLines?: string[] } = {}) =>
  buildApp({
    tools: emptyToolRegistry,
    actions,
    rateLimit: { max: opts.max ?? 1000 },
    logLevel: opts.logLines ? "info" : undefined,
    logStream: opts.logLines && { write: (line) => void opts.logLines?.push(line) },
  });

type App = Awaited<ReturnType<typeof build>>;

const body = (overrides: Record<string, unknown> = {}) => ({
  conversationId: CONVERSATION,
  uiId: UI_ID,
  action: "save_note",
  values: {},
  ...overrides,
});

const run = (app: App, payload: unknown, remoteAddress = "10.0.0.1") =>
  app.inject({
    method: "POST",
    url: "/api/actions/run",
    headers: { "content-type": "application/json" },
    payload: typeof payload === "string" ? payload : JSON.stringify(payload),
    remoteAddress,
  });

describe("POST /api/actions/run", () => {
  afterEach(() => {
    resetConversation(CONVERSATION);
    received = [];
  });

  const remember = () => rememberDesign(CONVERSATION, UI_ID, design);

  it("runs the action with only the values its schema declares", async () => {
    remember();
    const app = await build();
    const res = await run(app, body({ values: { note: "hi", search: "shoes", size: "M", gift: true } }));
    await app.close();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true, message: "Saved." });
    assert.deepEqual(received, [{ note: "hi", size: "M", gift: true }]);
  });

  it("returns 200 with ok: false when the registry refuses the values", async () => {
    remember();
    const app = await build();
    const res = await run(app, body({ values: { note: "too long" } }));
    await app.close();
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().ok, false);
    assert.match(res.json().message, /Invalid values for save_note/);
    assert.deepEqual(received, []);
  });

  it("gives 400 for each malformed body", async () => {
    remember();
    const app = await build();
    const tooMany = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, ""]));
    const malformed: unknown[] = [
      "",
      "{not json",
      [],
      body({ conversationId: undefined }),
      body({ conversationId: 1 }),
      body({ uiId: undefined }),
      body({ uiId: "" }),
      body({ action: undefined }),
      body({ action: ["save_note"] }),
      body({ values: undefined }),
      body({ values: [] }),
      body({ values: "note=hi" }),
      body({ values: { note: 1 } }),
      body({ values: { note: null } }),
      body({ values: { note: { text: "hi" } } }),
      body({ values: tooMany }),
    ];
    for (const payload of malformed) {
      const res = await run(app, payload);
      assert.equal(res.statusCode, 400, JSON.stringify(payload));
      assert.equal(typeof res.json().error.message, "string");
    }
    await app.close();
    assert.deepEqual(received, []);
  });

  it("gives 409 for an unknown design or conversation", async () => {
    remember();
    const app = await build();
    for (const payload of [body({ uiId: "design-2" }), body({ conversationId: "someone-else" })]) {
      const res = await run(app, payload);
      assert.equal(res.statusCode, 409);
      assert.deepEqual(res.json(), { error: { message: DESIGN_GONE_MESSAGE } });
    }
    await app.close();
  });

  it("refuses a disabled Button's action and an action the design doesn't have", async () => {
    remember();
    const app = await build();
    assert.equal((await run(app, body({ action: "order" }))).statusCode, 400);
    assert.equal((await run(app, body({ action: "delete_all" }))).statusCode, 400);
    await app.close();
  });

  it("refuses values that don't fit the design's inputs", async () => {
    remember();
    const app = await build();
    for (const values of [
      { pin: "1234" },
      { unknown: "x" },
      { note: true },
      { note: "x".repeat(1001) },
      { gift: "yes" },
      { size: "XL" },
    ]) {
      assert.equal((await run(app, body({ values }))).statusCode, 400, JSON.stringify(values));
    }
    // A Select on its placeholder sends "".
    assert.equal((await run(app, body({ values: { size: "" } }))).statusCode, 200);
    await app.close();
    assert.deepEqual(received, [{ size: "" }]);
  });

  it("gives 413 for a body over 32 KB", async () => {
    remember();
    const app = await build();
    const res = await run(app, body({ values: { note: "x".repeat(33 * 1024) } }));
    await app.close();
    assert.equal(res.statusCode, 413);
  });

  it("rate-limits per IP before parsing, separately from chat", async () => {
    remember();
    const app = await build({ max: 2 });
    assert.equal((await run(app, body())).statusCode, 200);
    assert.equal((await run(app, body())).statusCode, 200);
    const limited = await run(app, "{not json");
    assert.equal(limited.statusCode, 429);
    assert.match(limited.json().error.message, /^Too many messages\. Try again in \d+ seconds?\.$/);
    assert.ok(limited.headers["retry-after"]);
    assert.equal((await run(app, body(), "10.0.0.2")).statusCode, 200);
    const chat = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: {},
      remoteAddress: "10.0.0.1",
    });
    assert.equal(chat.statusCode, 400);
    await app.close();
  });

  it("logs one line per request with no submitted values", async () => {
    remember();
    const logLines: string[] = [];
    const app = await build({ logLines });
    await run(app, body({ values: { note: "s3cr", size: "M", search: "private-search" } }));
    await app.close();

    const entries = logLines
      .flatMap((chunk) => chunk.split("\n"))
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === "action request");
    assert.equal(entries.length, 1);
    const [entry] = entries;
    assert.equal(entry.conversationId, CONVERSATION);
    assert.equal(entry.action, "save_note");
    assert.equal(entry.ok, true);
    assert.equal(typeof entry.durationMs, "number");
    assert.ok(!("values" in entry));
    const all = logLines.join("");
    for (const secret of ["s3cr", "private-search"]) assert.ok(!all.includes(secret), secret);
  });
});
