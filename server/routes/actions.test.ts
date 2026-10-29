import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { UiNode } from "shared/ui";
import { createInMemoryPosMenu } from "../adapters/pos/InMemoryPosMenu";
import { createMenuActions } from "../actions/menu";
import { createActionRegistry } from "../actions/registry";
import type { ActionRegistry, ChoiceSource } from "../actions/types";
import { createDesignStore } from "../designs";
import { buildApp } from "../app";
import { DESIGN_GONE_MESSAGE } from "./actions";

const DESIGN_ID = "design-1";

let designs = createDesignStore({ max: 10 });

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
    { component: "Button", props: { label: "Remove", action: "remove_note" } },
  ],
};

/** Values each `save_note` run received. */
let received: Record<string, string | boolean>[] = [];
/** Values each `remove_note` run received. */
let removed: Record<string, string | boolean>[] = [];

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
  {
    name: "remove_note",
    description: "Removes a note.",
    input_schema: {
      type: "object",
      properties: {
        note: { type: "string", description: "The note." },
        size: { type: "string", description: "Size." },
      },
      additionalProperties: false,
    },
    confirm: "Remove {note} in size {size}?",
    async run(values) {
      removed.push(values);
      return { ok: true, message: "Removed." };
    },
  },
]);

const build = (opts: { max?: number; logLines?: string[]; actions?: ActionRegistry } = {}) =>
  buildApp({
    actions: opts.actions ?? actions,
    designs,
    rateLimit: { max: opts.max ?? 1000 },
    logLevel: opts.logLines ? "info" : undefined,
    logStream: opts.logLines && { write: (line) => void opts.logLines?.push(line) },
  });

type App = Awaited<ReturnType<typeof build>>;

const body = (overrides: Record<string, unknown> = {}) => ({
  designId: DESIGN_ID,
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
    designs = createDesignStore({ max: 10 });
    received = [];
    removed = [];
  });

  const remember = () => designs.remember(DESIGN_ID, design);

  it("runs the action with only the values its schema declares", async () => {
    remember();
    const app = await build();
    const res = await run(app, body({ values: { note: "hi", search: "shoes", size: "M", gift: true } }));
    await app.close();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true, message: "Saved.", stale: [] });
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
      body({ designId: undefined }),
      body({ designId: 1 }),
      body({ designId: "" }),
      body({ action: undefined }),
      body({ action: ["save_note"] }),
      body({ values: undefined }),
      body({ values: [] }),
      body({ values: "note=hi" }),
      body({ values: { note: 1 } }),
      body({ values: { note: null } }),
      body({ values: { note: { text: "hi" } } }),
      body({ values: tooMany }),
      body({ confirmed: "yes" }),
      body({ confirmed: null }),
      body({ confirmed: 1 }),
    ];
    for (const payload of malformed) {
      const res = await run(app, payload);
      assert.equal(res.statusCode, 400, JSON.stringify(payload));
      assert.equal(typeof res.json().error.message, "string");
    }
    await app.close();
    assert.deepEqual(received, []);
  });

  it("names the missing designId in its 400", async () => {
    const app = await build();
    const res = await run(app, body({ designId: undefined }));
    await app.close();
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.message, "designId and action must be non-empty strings.");
  });

  it("gives 409 for an unknown design", async () => {
    remember();
    const app = await build();
    for (const payload of [body({ designId: "design-2" })]) {
      const res = await run(app, payload);
      assert.equal(res.statusCode, 409);
      assert.deepEqual(res.json(), { error: { message: DESIGN_GONE_MESSAGE } });
    }
    assert.equal(DESIGN_GONE_MESSAGE, "This design is no longer available. Generate it again.");
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

  it("rate-limits per IP before parsing, separately from generate", async () => {
    remember();
    const app = await build({ max: 2 });
    assert.equal((await run(app, body())).statusCode, 200);
    assert.equal((await run(app, body())).statusCode, 200);
    const limited = await run(app, "{not json");
    assert.equal(limited.statusCode, 429);
    assert.match(limited.json().error.message, /^Too many messages\. Try again in \d+ seconds?\.$/);
    assert.ok(limited.headers["retry-after"]);
    assert.equal((await run(app, body(), "10.0.0.2")).statusCode, 200);
    const generate = await app.inject({
      method: "POST",
      url: "/api/generate",
      payload: {},
      remoteAddress: "10.0.0.1",
    });
    assert.equal(generate.statusCode, 400);
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
    assert.equal(entry.designId, DESIGN_ID);
    assert.equal(entry.action, "save_note");
    assert.equal(entry.ok, true);
    assert.equal(typeof entry.durationMs, "number");
    assert.ok(!("values" in entry));
    const all = logLines.join("");
    for (const secret of ["s3cr", "private-search"]) assert.ok(!all.includes(secret), secret);
  });

  describe("an action with a confirm question", () => {
    const remove = (overrides: Record<string, unknown> = {}) =>
      body({ action: "remove_note", values: { note: "hi", search: "shoes" }, ...overrides });

    it("answers an unconfirmed request with the filled question and doesn't run it", async () => {
      remember();
      const app = await build();
      for (const payload of [remove(), remove({ confirmed: false })]) {
        const res = await run(app, payload);
        assert.equal(res.statusCode, 200);
        const question = "Remove hi in size (none)?";
        assert.deepEqual(res.json(), { ok: false, message: question, confirm: question });
      }
      await app.close();
      assert.deepEqual(removed, []);
    });

    it("runs it with confirmed: true, with only the values its schema declares", async () => {
      remember();
      const app = await build();
      const res = await run(app, remove({ confirmed: true }));
      await app.close();
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { ok: true, message: "Removed.", stale: [] });
      assert.deepEqual(removed, [{ note: "hi" }]);
    });

    it("cuts a long question to the message limit", async () => {
      remember();
      const app = await build();
      const res = await run(app, remove({ values: { note: "x".repeat(1000) } }));
      await app.close();
      const { message, confirm } = res.json();
      assert.equal(message.length, 500);
      assert.equal(confirm, message);
      assert.ok(message.startsWith("Remove xxx"));
    });

    it("refuses a gone design or a failed check first, whether or not confirmed is set", async () => {
      remember();
      const app = await build();
      for (const confirmed of [undefined, true]) {
        const gone = await run(app, remove({ designId: "design-2", confirmed }));
        assert.equal(gone.statusCode, 409);
        assert.deepEqual(gone.json(), { error: { message: DESIGN_GONE_MESSAGE } });
        const badValues = await run(app, remove({ values: { pin: "1234" }, confirmed }));
        assert.equal(badValues.statusCode, 400);
      }
      await app.close();
      assert.deepEqual(removed, []);
    });

    it("ignores confirmed on an action without a question", async () => {
      remember();
      const app = await build();
      for (const confirmed of [true, false]) {
        const res = await run(app, body({ values: { note: "hi" }, confirmed }));
        assert.deepEqual(res.json(), { ok: true, message: "Saved.", stale: [] });
      }
      await app.close();
      assert.deepEqual(received, [{ note: "hi" }, { note: "hi" }]);
    });

    it("logs whether the question was asked or answered, without values or the question", async () => {
      remember();
      const logLines: string[] = [];
      const app = await build({ logLines });
      const values = { note: "s3cr", search: "private-search" };
      await run(app, remove({ values }));
      await run(app, remove({ values, confirmed: true }));
      await run(app, body({ values: { note: "hi" }, confirmed: true }));
      await app.close();

      const entries = logLines
        .flatMap((chunk) => chunk.split("\n"))
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((entry) => entry.msg === "action request");
      assert.deepEqual(
        entries.map(({ action, ok, confirmation }) => ({ action, ok, confirmation })),
        [
          { action: "remove_note", ok: false, confirmation: "asked" },
          { action: "remove_note", ok: true, confirmation: "given" },
          { action: "save_note", ok: true, confirmation: undefined },
        ],
      );
      assert.ok(!("confirmation" in entries[2]));
      const all = logLines.join("");
      for (const secret of ["s3cr", "private-search", "Remove "]) assert.ok(!all.includes(secret), secret);
    });
  });

  describe("a design with a Card per item", () => {
    const itemCard = (size: string) => ({
      component: "Card",
      children: [
        { component: "TextInput", props: { label: "Note", name: "note" } },
        { component: "Select", props: { label: "Size", name: "size", options: [size] } },
        { component: "Button", props: { label: "Save", action: "save_note" } },
      ],
    });
    const cards: UiNode = {
      component: "Stack",
      children: [itemCard("S"), itemCard("M"), { component: "TextInput", props: { label: "Search", name: "search" } }],
    };

    it("accepts the values of one Card", async () => {
      designs.remember(DESIGN_ID, cards);
      const app = await build();
      const res = await run(app, body({ values: { note: "hi", size: "M" } }));
      await app.close();
      assert.equal(res.statusCode, 200);
      assert.deepEqual(received, [{ note: "hi", size: "M" }]);
    });

    it("refuses a name outside every Card of the button, without echoing values", async () => {
      designs.remember(DESIGN_ID, cards);
      const app = await build();
      const res = await run(app, body({ values: { note: "private-note", search: "private-search" } }));
      await app.close();
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error.message, 'This design has no input named "search" next to a "save_note" button.');
      assert.deepEqual(received, []);
    });
  });

  describe("stale scopes on the demo menu", () => {
    const ITEMS = ["Bạc xỉu", "Bánh mì thịt"];
    const CATEGORIES = ["Bánh", "Cà phê", "Đá xay", "Trà"];
    const nameInput = { component: "TextInput", props: { label: "New name", name: "name" } };
    const categorySelect = { component: "Select", props: { label: "Category", name: "category", options: CATEGORIES } };
    const menuApp = () => build({ actions: createActionRegistry(createMenuActions(createInMemoryPosMenu())) });

    it("names only the renamed item's Card when each Card is locked to its item", async () => {
      const itemCard = (item: string) => ({
        component: "Card",
        children: [
          { component: "Select", props: { label: "Item", name: "item", options: ITEMS, value: item, disabled: true } },
          nameInput,
          { component: "Button", props: { label: "Save", action: "menu_update_item" } },
        ],
      });
      designs.remember(DESIGN_ID, { component: "Stack", children: ITEMS.map(itemCard) });
      const app = await menuApp();
      const res = await run(app, body({ action: "menu_update_item", values: { item: "Bạc xỉu", name: "Bạc xỉu nóng" } }));
      await app.close();
      assert.equal(res.json().ok, true, res.json().message);
      assert.deepEqual(res.json().stale, ["tree.children.0"]);
    });

    const categoryForms: UiNode = {
      component: "Stack",
      children: [
        {
          component: "Card",
          children: [nameInput, { component: "Button", props: { label: "Create", action: "menu_create_category" } }],
        },
        {
          component: "Card",
          children: [
            categorySelect,
            nameInput,
            { component: "Button", props: { label: "Rename", action: "menu_rename_category" } },
          ],
        },
        {
          component: "Card",
          children: [
            { component: "Select", props: { label: "Item", name: "item", options: ITEMS } },
            categorySelect,
            { component: "Button", props: { label: "Move", action: "menu_update_item" } },
          ],
        },
      ],
    };

    it("answers stale: [] when a new category leaves every option in place", async () => {
      designs.remember(DESIGN_ID, categoryForms);
      const app = await menuApp();
      const res = await run(app, body({ action: "menu_create_category", values: { name: "Bánh ngọt" } }));
      await app.close();
      assert.equal(res.json().ok, true, res.json().message);
      assert.deepEqual(res.json().stale, []);
    });

    it("names every Card whose enabled Select still offers a renamed category", async () => {
      designs.remember(DESIGN_ID, categoryForms);
      const app = await menuApp();
      const res = await run(app, body({ action: "menu_rename_category", values: { category: "Trà", name: "Trà sữa" } }));
      await app.close();
      assert.equal(res.json().ok, true, res.json().message);
      assert.deepEqual(res.json().stale, ["tree.children.1", "tree.children.2"]);
    });
  });

  describe("a dropdown source that fails to list", () => {
    const broken: ChoiceSource = {
      name: "broken_sizes",
      async list() {
        throw new Error("source down");
      },
    };
    const sizeSchema = {
      type: "object",
      properties: { size: { type: "string", description: "Size." } },
      additionalProperties: false,
    };
    const sizeActions = createActionRegistry([
      {
        name: "pick_size",
        description: "Picks a size.",
        input_schema: sizeSchema,
        choices: { size: broken },
        async run(values) {
          return values.size === "S" ? { ok: false, message: "S is sold out." } : { ok: true, message: "Picked." };
        },
      },
      {
        name: "drop_size",
        description: "Drops a size.",
        input_schema: sizeSchema,
        choices: { size: broken },
        confirm: "Drop {size}?",
        async run() {
          return { ok: true, message: "Dropped." };
        },
      },
    ]);
    const sizeDesign: UiNode = {
      component: "Stack",
      children: [
        { component: "Heading", props: { text: "Sizes" } },
        {
          component: "Card",
          children: [
            { component: "Select", props: { label: "Size", name: "size", options: ["S", "private-size"] } },
            { component: "Button", props: { label: "Pick", action: "pick_size" } },
            { component: "Button", props: { label: "Drop", action: "drop_size" } },
          ],
        },
      ],
    };

    it("still answers ok: true with its message, with the scopes bound to it stale", async () => {
      designs.remember(DESIGN_ID, sizeDesign);
      const logLines: string[] = [];
      const app = await build({ actions: sizeActions, logLines });
      const res = await run(app, body({ action: "pick_size", values: { size: "private-size" } }));
      await app.close();
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { ok: true, message: "Picked.", stale: ["tree.children.1"] });
      const all = logLines.join("");
      assert.match(all, /loading dropdown values failed/);
      assert.match(all, /broken_sizes/);
      assert.ok(!all.includes("private-size"));
    });

    it("carries no stale on a failed action, a confirm question, a 400 or a 409", async () => {
      designs.remember(DESIGN_ID, sizeDesign);
      const app = await build({ actions: sizeActions });
      const answers = [
        await run(app, body({ action: "pick_size", values: { size: "S" } })),
        await run(app, body({ action: "drop_size", values: { size: "S" } })),
        await run(app, body({ action: "pick_size", values: { size: "XL" } })),
        await run(app, body({ action: "pick_size", designId: "design-2" })),
      ];
      await app.close();
      assert.deepEqual(
        answers.map((res) => [res.statusCode, res.json().ok, res.json().confirm]),
        [
          [200, false, undefined],
          [200, false, "Drop S?"],
          [400, undefined, undefined],
          [409, undefined, undefined],
        ],
      );
      for (const res of answers) assert.ok(!("stale" in res.json()), res.body);
    });
  });
});
