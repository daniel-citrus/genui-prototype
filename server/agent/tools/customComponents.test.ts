import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_CUSTOM_COMPONENT_VERSIONS, type CustomComponentDefinition } from "shared/customComponents";
import type { ActionSpec } from "../../actions/types";
import { catalog } from "../../catalog/components";
import { validateDefinition } from "../../customComponents/definition";
import { barChart, menuItemCard, panel, withTemplate } from "../../customComponents/testDefinitions";
import { CustomComponentError, type CustomComponentRepository } from "../../ports/CustomComponentRepository";
import { InMemoryComponentRepository } from "../../ports/fakes/InMemoryComponentRepository";
import { InMemoryCustomComponentRepository } from "../../ports/fakes/InMemoryCustomComponentRepository";
import { createToolRegistry } from "../registry";
import type { ToolContext } from "../tools";
import { createAgentTools } from "./index";

const placeOrder: ActionSpec = {
  name: "place_order",
  description: "Order some.",
  input_schema: {
    type: "object",
    properties: { qty: { type: "string", description: "How many." } },
    required: ["qty"],
    additionalProperties: false,
  },
};

/** A Markup form with a quantity input and a button for `action`. */
const orderForm = (action: string) =>
  withTemplate("OrderForm", {
    component: "Markup",
    props: {
      root: {
        tag: "div",
        children: [
          { tag: "input", attrs: { name: "qty" } },
          { tag: "button", action, text: "Order" },
        ],
      },
    },
  });

/** define_component's arguments for `definition`. */
function args(definition: CustomComponentDefinition): Record<string, unknown> {
  const { propsSchema, exampleProps, ...rest } = definition;
  return { ...rest, props_schema: propsSchema, example_props: exampleProps };
}

/** The tools over the catalog, `repo` and the place_order action; `logs` records every log call. */
function setup(repo: CustomComponentRepository = new InMemoryCustomComponentRepository()) {
  const logs: { level: string; obj: object; msg?: string }[] = [];
  const ctx: ToolContext = {
    signal: new AbortController().signal,
    log: {
      info: (obj, msg) => void logs.push({ level: "info", obj, msg }),
      debug() {},
      warn() {},
      error: (obj, msg) => void logs.push({ level: "error", obj, msg }),
    },
    showUi() {},
  };
  const components = new InMemoryComponentRepository(catalog);
  const tools = createAgentTools({ components, actions: [placeOrder], customComponents: repo });
  return { registry: createToolRegistry(tools), components, repo, ctx, logs };
}

/** A repository whose every method throws like Drizzle does when Postgres is down. */
function downRepository(): CustomComponentRepository {
  const repo = new InMemoryCustomComponentRepository();
  const fail = async (): Promise<never> => {
    const cause = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    throw Object.assign(new Error(`Failed query: insert\nparams: ${JSON.stringify(menuItemCard)}`), { cause });
  };
  repo.list = repo.getByName = repo.save = repo.softDelete = fail;
  return repo;
}

describe("define_component", () => {
  it("saves a valid definition as v1, then as v2", async () => {
    const { registry, repo, ctx } = setup();

    assert.deepEqual(await registry.run("define_component", args(menuItemCard), ctx), {
      ok: true,
      summary: "Saved MenuItemCard v1",
      data: { name: "MenuItemCard", version: 1 },
    });
    const changed = { ...menuItemCard, description: "A menu item card." };
    assert.deepEqual(await registry.run("define_component", args(changed), ctx), {
      ok: true,
      summary: "Saved MenuItemCard v2",
      data: { name: "MenuItemCard", version: 2 },
    });
    const { version, versions, createdAt, updatedAt, deletedAt, ...stored } = (await repo.getByName("MenuItemCard"))!;
    assert.deepEqual([version, versions, deletedAt], [2, 2, null]);
    assert.deepEqual(stored, changed);
  });

  it("saves a Markup component whose button runs a registered action", async () => {
    const { registry, ctx } = setup();
    const result = await registry.run("define_component", args(orderForm("place_order")), ctx);

    assert.equal(result.summary, "Saved OrderForm v1");
  });

  it("returns every problem validateDefinition finds and saves nothing", async () => {
    const { registry, components, repo, ctx } = setup();
    await repo.save(panel);
    const definition = {
      ...orderForm("send_mail"),
      name: "Button",
      description: "",
      template: { component: "Stack", children: [orderForm("send_mail").template, { component: "Gauge" }] },
    };
    const expected = await validateDefinition(definition, {
      catalog: await components.list(),
      resolve: (n) => repo.getByName(n),
      actions: [placeOrder],
    });
    assert.ok(!expected.ok && expected.errors.length >= 3);

    const result = await registry.run("define_component", args(definition), ctx);
    assert.deepEqual(result, {
      ok: false,
      summary: `Definition has ${expected.errors.length} problems`,
      data: { errors: expected.errors },
    });
    assert.deepEqual((await repo.list({ includeDeleted: true })).components.map((c) => c.name), ["Panel"]);
  });

  it("refuses a button that names an unregistered action", async () => {
    const { registry, repo, ctx } = setup();
    const result = await registry.run("define_component", args(orderForm("send_mail")), ctx);

    assert.deepEqual(result, {
      ok: false,
      summary: "Definition has 1 problem",
      data: { errors: ['template.props.root.children.1.action "send_mail" is not a registered action (call list_actions to see them)'] },
    });
    assert.equal(await repo.getByName("OrderForm"), undefined);
  });

  it("returns the repository's refusals", async () => {
    const { registry, repo, ctx } = setup();
    for (let i = 0; i < MAX_CUSTOM_COMPONENT_VERSIONS; i++) await repo.save(menuItemCard);
    await repo.save(barChart);
    await repo.softDelete("BarChart");
    await repo.save(panel);

    const refusals = [
      [menuItemCard, `"MenuItemCard" already has the limit of ${MAX_CUSTOM_COMPONENT_VERSIONS} versions.`],
      [barChart, '"BarChart" is deleted: restore it first, or pick another name.'],
      [
        { ...panel, name: "PANEL" },
        '"Panel" already exists and names are unique ignoring case: save as "Panel" to change it, or pick another name.',
      ],
    ] as const;
    for (const [definition, summary] of refusals) {
      assert.deepEqual(await registry.run("define_component", args(definition), ctx), { ok: false, summary });
    }

    repo.save = async () => {
      throw new CustomComponentError("conflict", '"Panel" changed while saving, try again.');
    };
    assert.deepEqual(await registry.run("define_component", args(panel), ctx), {
      ok: false,
      summary: '"Panel" changed while saving, try again.',
    });
    assert.equal((await repo.getByName("Panel"))!.versions, 1);
  });

  it("logs names, versions and outcomes, never the definition", async () => {
    const { registry, ctx, logs } = setup();
    await registry.run("define_component", args(menuItemCard), ctx);
    await registry.run("define_component", args({ ...menuItemCard, description: "" }), ctx);
    await registry.run("define_component", args({ ...menuItemCard, name: "MENUITEMCARD" }), ctx);

    assert.deepEqual(
      logs.map((l) => l.obj),
      [
        { name: "MenuItemCard", version: 1 },
        { name: "MenuItemCard", problems: 1 },
        { name: "MENUITEMCARD", code: "name_taken" },
      ],
    );
  });

  it("reports custom components unavailable when the repository fails, and logs only the cause", async () => {
    const { registry, ctx, logs } = setup(downRepository());
    const result = await registry.run("define_component", args(menuItemCard), ctx);

    assert.deepEqual(result, { ok: false, summary: "Custom components are unavailable" });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].level, "error");
    const { name, err } = logs[0].obj as { name: string; err: Error };
    assert.equal(name, "MenuItemCard");
    assert.equal(err.message, "connect ECONNREFUSED 127.0.0.1:5432");
  });
});

describe("delete_component", () => {
  it("hides a custom component from list_components and get_component", async () => {
    const { registry, repo, ctx, logs } = setup();
    await repo.save(menuItemCard);

    assert.deepEqual(await registry.run("delete_component", { name: "MenuItemCard" }, ctx), {
      ok: true,
      summary: "Deleted MenuItemCard; it can be restored from the Components panel",
    });
    assert.notEqual((await repo.getByName("MenuItemCard"))!.deletedAt, null);
    const listed = (await registry.run("list_components", {}, ctx)).data as { components: { name: string }[] };
    assert.ok(!listed.components.some((c) => c.name === "MenuItemCard"));
    const read = await registry.run("get_component", { name: "MenuItemCard" }, ctx);
    assert.equal(read.summary, "No component named MenuItemCard");
    assert.deepEqual(logs.map((l) => l.obj), [{ name: "MenuItemCard" }]);
  });

  it("refuses unknown, deleted and catalog names", async () => {
    const { registry, repo, ctx } = setup();
    await repo.save(menuItemCard);
    await repo.save(barChart);
    await repo.softDelete("BarChart");

    for (const [name, summary] of [
      ["Gauge", "No custom component named Gauge"],
      ["menuitemcard", "No custom component named menuitemcard"],
      ["BarChart", "No custom component named BarChart"],
      ["Button", "Button is a catalog component; only custom components can be deleted"],
      ["markup", "Markup is a catalog component; only custom components can be deleted"],
    ]) {
      assert.deepEqual(await registry.run("delete_component", { name }, ctx), { ok: false, summary });
    }
    assert.equal((await repo.getByName("MenuItemCard"))!.deletedAt, null);
  });

  it("reports custom components unavailable when the repository fails", async () => {
    const { registry, ctx, logs } = setup(downRepository());

    assert.deepEqual(await registry.run("delete_component", { name: "MenuItemCard" }, ctx), {
      ok: false,
      summary: "Custom components are unavailable",
    });
    assert.equal(logs.length, 1);
  });
});
