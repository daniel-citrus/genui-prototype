import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActionOperation, ActionSpec } from "../../actions/types";
import { catalog } from "../../catalog/components";
import { InMemoryComponentRepository } from "../../ports/fakes/InMemoryComponentRepository";
import { createToolRegistry } from "../registry";
import type { ToolContext, ToolDefinition } from "../tools";
import { MAX_CHOICES, MAX_LISTED_ACTIONS, listActionsTool } from "./actions";
import { createAgentTools } from "./index";

const ctx: ToolContext = {
  signal: new AbortController().signal,
  log: { info() {}, debug() {}, error() {}, warn() {} },
  showUi() {},
};
const components = new InMemoryComponentRepository(catalog);

const inputSchema = {
  type: "object",
  properties: { item: { type: "string", description: "The item." } },
  additionalProperties: false,
};
const longDescription = `Delete a modifier group for good. ${"It is no longer offered on any item. ".repeat(5)}`;

/** The menu actions' names, areas and operations, after a demo action with neither. */
const menu: [string, string, ActionOperation, Partial<ActionSpec>?][] = [
  ["menu_create_item", "items", "create"],
  ["menu_update_item", "items", "edit", { choices: { item: "menu_items", category: "menu_categories" } }],
  ["menu_set_item_archived", "items", "archive", { choices: { item: "menu_items" } }],
  ["menu_set_item_image", "items", "edit", { choices: { item: "menu_items" } }],
  ["menu_attach_modifier_group", "modifier_groups", "attach"],
  ["menu_detach_modifier_group", "modifier_groups", "detach"],
  ["menu_add_size", "sizes", "create"],
  ["menu_update_size", "sizes", "edit"],
  ["menu_set_size_price", "prices", "edit", { choices: { size: "menu_item_sizes" } }],
  ["menu_remove_size", "sizes", "delete"],
  ["menu_create_category", "categories", "create"],
  ["menu_rename_category", "categories", "edit"],
  [
    "menu_delete_category",
    "categories",
    "delete",
    {
      choices: { category: "menu_categories" },
      confirm: "Delete the category {category}? This can't be undone.",
    },
  ],
  ["menu_delete_modifier_group", "modifier_groups", "delete", { description: longDescription }],
];
const specs: ActionSpec[] = [
  { name: "demo_echo", description: "Echo the message back.", input_schema: inputSchema },
  ...menu.map(([name, area, operation, extra]) => ({
    name,
    description: `Runs ${name}.`,
    input_schema: inputSchema,
    area,
    operation,
    ...extra,
  })),
];

/** A source per name; records each call. */
function fakeChoices(sources: Record<string, string[] | Error>) {
  const calls: { source: string; signal: AbortSignal }[] = [];
  async function listChoices(source: string, signal: AbortSignal) {
    calls.push({ source, signal });
    const found = sources[source];
    if (found instanceof Error) throw found;
    return found ?? [];
  }
  return { calls, listChoices };
}

async function list(args: Record<string, unknown>, tool = listActionsTool(specs), context = ctx) {
  return createToolRegistry([tool]).run("list_actions", args, context);
}

/** The tool's allowed areas and operations. */
function enums(tool: ToolDefinition) {
  const { properties } = tool.input_schema as { properties: Record<string, { enum: string[] }> };
  return { area: properties.area.enum, operation: properties.operation.enum };
}

function listedNames(data: unknown) {
  return (data as { actions: { name: string }[] }).actions.map((a) => a.name);
}

describe("list_actions", () => {
  it("offers the registered areas and operations, plus any", () => {
    const { area, operation } = enums(listActionsTool(specs));
    assert.deepEqual(area, [
      "categories",
      "items",
      "modifier_groups",
      "other",
      "prices",
      "sizes",
      "any",
    ]);
    assert.deepEqual(operation, [
      "create",
      "edit",
      "archive",
      "delete",
      "attach",
      "detach",
      "other",
      "any",
    ]);

    const createAndDelete = specs.filter((s) => s.operation === "delete" || s.operation === "create");
    assert.deepEqual(enums(listActionsTool(createAndDelete)).operation, ["create", "delete", "any"]);
  });

  it("refuses an unknown or missing area or operation", async () => {
    for (const args of [
      { area: "widgets", operation: "edit" },
      { area: "items", operation: "rename" },
      { area: "items" },
      { operation: "edit" },
      { area: "items", operation: "edit", name: "menu_update_item" },
    ]) {
      const result = await list(args);
      assert.equal(result.ok, false, JSON.stringify(args));
      assert.equal(result.summary, "Invalid arguments for list_actions");
    }
  });

  it("returns the actions that fit both, in full and in registry order", async () => {
    const result = await list({ area: "items", operation: "edit" });
    assert.equal(result.ok, true);
    assert.equal(result.summary, "Listed 2 actions");
    const data = result.data as { match: string; actions: unknown[] };
    assert.equal(data.match, "exact");
    assert.deepEqual(data.actions, [
      {
        name: "menu_update_item",
        description: "Runs menu_update_item.",
        input_schema: inputSchema,
        area: "items",
        operation: "edit",
        choices: { item: "menu_items", category: "menu_categories" },
      },
      {
        name: "menu_set_item_image",
        description: "Runs menu_set_item_image.",
        input_schema: inputSchema,
        area: "items",
        operation: "edit",
        choices: { item: "menu_items" },
      },
    ]);
    assert.ok(!("choices" in data), "no choices without listChoices");
  });

  it("finds one action by area and operation", async () => {
    const cases: [string, string, string][] = [
      ["categories", "delete", "menu_delete_category"],
      ["prices", "edit", "menu_set_size_price"],
      ["items", "archive", "menu_set_item_archived"],
      ["other", "any", "demo_echo"],
    ];
    for (const [area, operation, name] of cases) {
      const result = await list({ area, operation });
      assert.equal(result.summary, "Listed 1 actions");
      assert.deepEqual(listedNames(result.data), [name], `${area} + ${operation}`);
    }
  });

  it("includes the confirm question, and other for a missing area or operation", async () => {
    const deleted = await list({ area: "categories", operation: "delete" });
    const [category] = (deleted.data as { actions: Record<string, unknown>[] }).actions;
    assert.equal(category.confirm, "Delete the category {category}? This can't be undone.");

    const echo = await list({ area: "other", operation: "other" });
    assert.deepEqual((echo.data as { actions: unknown[] }).actions, [
      {
        name: "demo_echo",
        description: "Echo the message back.",
        input_schema: inputSchema,
        area: "other",
        operation: "other",
      },
    ]);
  });

  it("falls back to the area's actions when none fit both", async () => {
    const result = await list({ area: "items", operation: "delete" });
    assert.equal(result.ok, true);
    assert.equal(result.summary, "Listed 4 actions (no exact match)");
    assert.equal((result.data as { match: string }).match, "area");
    assert.deepEqual(listedNames(result.data), [
      "menu_create_item",
      "menu_update_item",
      "menu_set_item_archived",
      "menu_set_item_image",
    ]);
  });

  it("returns at most 10 in full and lists the rest under others", async () => {
    const result = await list({ area: "any", operation: "any" });
    assert.equal(result.summary, `Listed ${MAX_LISTED_ACTIONS} actions`);
    const data = result.data as { match: string; others: { name: string; description: string }[] };
    assert.equal(data.match, "exact");
    assert.deepEqual(listedNames(data), specs.slice(0, 10).map((s) => s.name));
    assert.deepEqual(
      data.others,
      specs.slice(10).map(({ name, area, operation, description }) => ({
        name,
        area,
        operation,
        description: description.slice(0, 120),
      })),
    );
    const cut = data.others.find((o) => o.name === "menu_delete_modifier_group");
    assert.ok(longDescription.length > 120);
    assert.equal(cut?.description, longDescription.slice(0, 120));
  });

  it("lists every action not returned in full under others", async () => {
    for (const args of [
      { area: "items", operation: "edit" },
      { area: "items", operation: "delete" },
      { area: "other", operation: "any" },
      { area: "any", operation: "any" },
    ]) {
      const data = (await list(args)).data as { others: { name: string; description: string }[] };
      const listed = listedNames(data);
      const others = data.others.map((o) => o.name);
      assert.deepEqual(
        specs.map((s) => s.name).filter((name) => !listed.includes(name)),
        others,
        JSON.stringify(args),
      );
      assert.ok(data.others.every((o) => o.description.length <= 120));
    }
  });

  it("lists none when no actions are registered", async () => {
    const tool = listActionsTool([]);
    assert.deepEqual(enums(tool), { area: ["any"], operation: ["any"] });

    const result = await list({ area: "any", operation: "any" }, tool);
    assert.deepEqual(result, {
      ok: true,
      summary: "Listed 0 actions",
      data: { match: "exact", actions: [], others: [] },
    });
  });
});

describe("list_actions choices", () => {
  it("loads each source a returned action names once, with the call's signal", async () => {
    const { calls, listChoices } = fakeChoices({
      menu_items: ["Latte", "Mocha"],
      menu_categories: ["Coffee", "Tea"],
    });
    const result = await list({ area: "items", operation: "edit" }, listActionsTool(specs, listChoices));

    assert.equal(result.ok, true);
    assert.deepEqual((result.data as { choices: unknown }).choices, {
      menu_items: { values: ["Latte", "Mocha"], truncated: false },
      menu_categories: { values: ["Coffee", "Tea"], truncated: false },
    });
    assert.deepEqual(calls.map((c) => c.source).sort(), ["menu_categories", "menu_items"]);
    assert.ok(calls.every((c) => c.signal === ctx.signal));
  });

  it("lists at most 50 values, in the source's order, and says when there are more", async () => {
    const many = Array.from({ length: MAX_CHOICES + 1 }, (_, i) => `Size ${MAX_CHOICES - i}`);
    const { listChoices } = fakeChoices({
      menu_item_sizes: many,
      menu_items: many.slice(0, MAX_CHOICES),
    });
    const tool = listActionsTool(specs, listChoices);

    const prices = await list({ area: "prices", operation: "edit" }, tool);
    assert.deepEqual((prices.data as { choices: unknown }).choices, {
      menu_item_sizes: { values: many.slice(0, MAX_CHOICES), truncated: true },
    });

    const archive = await list({ area: "items", operation: "archive" }, tool);
    assert.deepEqual((archive.data as { choices: unknown }).choices, {
      menu_items: { values: many.slice(0, MAX_CHOICES), truncated: false },
    });
  });

  it("reports a source that fails, logs it, and still answers", async () => {
    const failure = new Error("menu offline");
    const { listChoices } = fakeChoices({ menu_items: failure, menu_categories: ["Coffee"] });
    const logged: object[] = [];
    const context: ToolContext = { ...ctx, log: { ...ctx.log, error: (obj) => logged.push(obj) } };

    const result = await list({ area: "items", operation: "edit" }, listActionsTool(specs, listChoices), context);

    assert.equal(result.ok, true);
    assert.deepEqual((result.data as { choices: unknown }).choices, {
      menu_items: { values: [], truncated: false, error: "Couldn't load these choices." },
      menu_categories: { values: ["Coffee"], truncated: false },
    });
    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0], { tool: "list_actions", source: "menu_items", err: failure });
  });

  it("has an empty choices object when no returned action takes one", async () => {
    const { calls, listChoices } = fakeChoices({});
    const result = await list({ area: "sizes", operation: "create" }, listActionsTool(specs, listChoices));
    assert.deepEqual((result.data as { choices: unknown }).choices, {});
    assert.equal(calls.length, 0);
  });

  it("is wired through createAgentTools", async () => {
    const { listChoices } = fakeChoices({ menu_categories: ["Coffee"] });
    const registry = createToolRegistry(createAgentTools({ components, actions: specs, listChoices }));
    const result = await registry.run("list_actions", { area: "categories", operation: "delete" }, ctx);
    assert.deepEqual((result.data as { choices: unknown }).choices, {
      menu_categories: { values: ["Coffee"], truncated: false },
    });
  });
});
