import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UiNode } from "shared/ui";
import type { ActionSpec } from "../../actions/types";
import { catalog } from "../../catalog/components";
import type { ComponentRepository } from "../../ports/ComponentRepository";
import { InMemoryComponentRepository } from "../../ports/fakes/InMemoryComponentRepository";
import { createToolRegistry } from "../registry";
import type { ToolContext } from "../tools";
import { createAgentTools } from "./index";
import { renderUiTool } from "./ui";

function setup(
  components: ComponentRepository = new InMemoryComponentRepository(catalog),
  actions?: ActionSpec[],
) {
  const shown: UiNode[] = [];
  const errors: object[] = [];
  const ctx: ToolContext = {
    signal: new AbortController().signal,
    log: { info() {}, debug() {}, error: (obj) => void errors.push(obj) },
    showUi: (tree) => void shown.push(tree),
  };
  return { registry: createToolRegistry(createAgentTools({ components, actions })), ctx, shown, errors };
}

describe("render_ui", () => {
  it("shows a valid tree once and reports the stats without echoing it", async () => {
    const { registry, ctx, shown } = setup();
    const tree = {
      component: "Stack",
      children: [{ component: "Button", props: { label: "Go" } }, { component: "Divider" }],
    };
    const result = await registry.run("render_ui", { tree }, ctx);

    assert.deepEqual(result, {
      ok: true,
      summary: "Rendered 3 components",
      data: { stats: { nodes: 3, depth: 2, components: { Stack: 1, Button: 1, Divider: 1 } } },
    });
    assert.equal(shown.length, 1);
    assert.deepEqual(shown[0], tree);
  });

  it("shows nothing and returns the errors for an invalid tree", async () => {
    const { registry, ctx, shown } = setup();
    const result = await registry.run(
      "render_ui",
      { tree: { component: "Stack", children: [{ component: "Button" }, { component: "button" }] } },
      ctx,
    );

    assert.equal(result.ok, false);
    assert.equal(result.summary, "UI has 2 problems");
    assert.deepEqual(result.data, {
      errors: [
        "tree.children.0.props.label is required",
        'tree.children.1.component "button" is not in the catalog (did you mean Button?)',
      ],
    });
    assert.equal(shown.length, 0);
  });

  it("uses the singular for one problem", async () => {
    const { registry, ctx } = setup();
    const result = await registry.run("render_ui", { tree: { component: "Nope" } }, ctx);
    assert.equal(result.summary, "UI has 1 problem");
  });

  it("refuses a Button bound to an unregistered action and shows nothing", async () => {
    const actions: ActionSpec[] = [
      {
        name: "demo_echo",
        description: "Echo.",
        input_schema: { type: "object", properties: {}, additionalProperties: false },
      },
    ];
    const { registry, ctx, shown } = setup(undefined, actions);
    const go = (action: string) => ({ tree: { component: "Button", props: { label: "Go", action } } });

    const result = await registry.run("render_ui", go("send_mail"), ctx);
    assert.deepEqual(result, {
      ok: false,
      summary: "UI has 1 problem",
      data: {
        errors: ['tree.props.action "send_mail" is not a registered action (call list_actions to see them)'],
      },
    });
    assert.equal(shown.length, 0);

    assert.equal((await registry.run("render_ui", go("demo_echo"), ctx)).ok, true);
    assert.equal(shown.length, 1);
  });

  it("refuses a missing or non-object tree before the tool runs", async () => {
    const { registry, ctx, shown } = setup();
    for (const args of [{}, { tree: "Stack" }, { tree: { component: "Divider" }, extra: 1 }]) {
      const result = await registry.run("render_ui", args, ctx);
      assert.equal(result.ok, false);
      assert.equal(result.summary, "Invalid arguments for render_ui");
    }
    assert.equal(shown.length, 0);
  });

  it("reports a repository error as a failed tool call and logs it", async () => {
    const broken: ComponentRepository = {
      list: async () => {
        throw new Error("connect ECONNREFUSED");
      },
      get: async () => undefined,
      getByName: async () => undefined,
    };
    const { registry, ctx, shown, errors } = setup(broken);
    const result = await registry.run("render_ui", { tree: { component: "Divider" } }, ctx);

    assert.deepEqual(result, { ok: false, summary: "render_ui failed" });
    assert.equal(shown.length, 0);
    assert.equal(errors.length, 1);
  });
});

describe("render_ui dropdown checks", () => {
  const itemProperty = { type: "string", description: "An item." };
  const menuActions: ActionSpec[] = [
    {
      name: "menu_update_item",
      description: "Change an item.",
      operation: "edit",
      choices: { item: "menu_items", category: "menu_categories" },
      input_schema: {
        type: "object",
        properties: { item: itemProperty, category: { type: "string", description: "Its new category." } },
        required: ["item"],
        additionalProperties: false,
      },
    },
    {
      name: "menu_merge_items",
      description: "Merge one item into another.",
      choices: { item: "menu_items", into: "menu_items" },
      input_schema: {
        type: "object",
        properties: { item: itemProperty, into: itemProperty },
        required: ["item", "into"],
        additionalProperties: false,
      },
    },
  ];
  const values: Record<string, string[]> = {
    menu_items: ["Bạc xỉu", "Cà phê sữa đá"],
    menu_categories: ["Coffee", "Tea"],
  };

  function setupChoices(failing: string[] = []) {
    const { ctx, shown, errors } = setup();
    const loads: string[] = [];
    const listChoices = async (source: string, signal: AbortSignal) => {
      assert.equal(signal, ctx.signal);
      loads.push(source);
      if (failing.includes(source)) throw new Error(`${source} is down`);
      return values[source];
    };
    const components = new InMemoryComponentRepository(catalog);
    const registry = createToolRegistry([renderUiTool(components, menuActions, listChoices)]);
    return { registry, ctx, shown, errors, loads };
  }

  const select = (name: string, ...options: string[]) => ({
    component: "Select",
    props: { label: name, options, name },
  });
  const button = (action: string) => ({ component: "Button", props: { label: "Go", action } });
  const tree = (...children: unknown[]) => ({ tree: { component: "Stack", children } });

  it("loads each source once per call, even when several inputs and actions use it", async () => {
    const { registry, ctx, shown, loads } = setupChoices();
    const args = tree(
      select("item", "Bạc xỉu"),
      select("into", "Cà phê sữa đá"),
      select("category", "Tea"),
      button("menu_update_item"),
      button("menu_merge_items"),
    );

    assert.equal((await registry.run("render_ui", args, ctx)).ok, true);
    assert.deepEqual(loads.toSorted(), ["menu_categories", "menu_items"]);
    assert.equal((await registry.run("render_ui", args, ctx)).ok, true);
    assert.equal(loads.length, 4);
    assert.equal(shown.length, 2);
  });

  it("refuses an option the source doesn't have and shows nothing", async () => {
    const { registry, ctx, shown } = setupChoices();
    const result = await registry.run(
      "render_ui",
      tree(select("item", "Latte"), select("category", "Tea"), button("menu_update_item")),
      ctx,
    );
    assert.deepEqual(result, {
      ok: false,
      summary: "UI has 1 problem",
      data: {
        errors: [
          'tree.children.0.props.options "Latte" is not one of the menu_items values (call list_actions to get them)',
        ],
      },
    });
    assert.equal(shown.length, 0);
  });

  it("skips a source that fails to load, logs it, and still checks the rest", async () => {
    const { registry, ctx, errors } = setupChoices(["menu_categories"]);
    const result = await registry.run(
      "render_ui",
      tree(select("item", "Latte"), select("category", "Juice"), button("menu_update_item")),
      ctx,
    );
    assert.deepEqual(result.data, {
      errors: [
        'tree.children.0.props.options "Latte" is not one of the menu_items values (call list_actions to get them)',
      ],
    });
    assert.equal(errors.length, 1);
    assert.equal((errors[0] as { source?: string }).source, "menu_categories");
  });

  it("loads only sources of inputs in the tree whose action some Button names", async () => {
    const { registry, ctx, loads } = setupChoices();
    await registry.run("render_ui", tree(select("item", "Latte"), button("menu_update_item")), ctx);
    await registry.run("render_ui", tree(select("item", "Latte"), select("category", "Juice")), ctx);
    assert.deepEqual(loads, ["menu_items"]);
  });

  it("checks no dropdowns without listChoices", async () => {
    const components = new InMemoryComponentRepository(catalog);
    const registry = createToolRegistry([renderUiTool(components, menuActions)]);
    const { ctx } = setup();
    const result = await registry.run(
      "render_ui",
      tree(select("item", "Latte"), select("category", "Juice"), button("menu_update_item")),
      ctx,
    );
    assert.equal(result.ok, true);
  });
});
