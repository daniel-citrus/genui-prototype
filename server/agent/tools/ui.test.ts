import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TemplateNode } from "shared/customComponents";
import type { UiNode } from "shared/ui";
import type { ActionSpec } from "../../actions/types";
import { catalog } from "../../catalog/components";
import { menuItemCard, panel, specials, withTemplate } from "../../customComponents/testDefinitions";
import type { ComponentRepository } from "../../ports/ComponentRepository";
import type { CustomComponentRepository } from "../../ports/CustomComponentRepository";
import { InMemoryComponentRepository } from "../../ports/fakes/InMemoryComponentRepository";
import { InMemoryCustomComponentRepository } from "../../ports/fakes/InMemoryCustomComponentRepository";
import { checkActionRequest } from "../../ui/checkAction";
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
    log: { info() {}, debug() {}, warn() {}, error: (obj) => void errors.push(obj) },
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

describe("render_ui with custom components", () => {
  const latte = { name: "Latte", price: "$4.50", photo: "https://example.com/latte.jpg" };
  const stack = (...children: unknown[]) => ({ component: "Stack", children });
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
  const orderForm = (name: string, action: string) =>
    withTemplate(name, {
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

  /**
   * render_ui over the catalog and `customComponents`, by default a repository
   * holding the test definitions; `calls` lists what that one was asked.
   */
  async function setupCustom(customComponents?: CustomComponentRepository) {
    const repo = new InMemoryCustomComponentRepository();
    for (const definition of [menuItemCard, panel, specials, orderForm("OrderForm", "place_order")]) {
      await repo.save(definition);
    }
    const calls: string[] = [];
    const getByName = repo.getByName.bind(repo);
    const list = repo.list.bind(repo);
    repo.getByName = (name) => (calls.push(name), getByName(name));
    repo.list = (opts) => (calls.push(`list ${opts?.search}`), list(opts));
    const { ctx, shown, errors } = setup();
    const components = new InMemoryComponentRepository(catalog);
    const tools = createAgentTools({ components, actions: [placeOrder], customComponents: customComponents ?? repo });
    return { registry: createToolRegistry(tools), repo, calls, ctx, shown, errors };
  }

  const names = (node: UiNode): string[] => [node.component, ...(node.children ?? []).flatMap(names)];

  it("validates and shows the expanded tree and counts its nodes", async () => {
    const { registry, ctx, shown } = await setupCustom();
    const result = await registry.run("render_ui", { tree: stack({ component: "MenuItemCard", props: latte }) }, ctx);

    assert.deepEqual(result, {
      ok: true,
      summary: "Rendered 5 components",
      data: { stats: { nodes: 5, depth: 3, components: { Stack: 1, Card: 1, Image: 1, Heading: 1, Badge: 1 } } },
    });
    assert.deepEqual(shown, [
      stack({
        component: "Card",
        props: {},
        children: [
          { component: "Image", props: { src: latte.photo, alt: "Latte" } },
          { component: "Heading", props: { text: "Latte", level: 3 } },
          { component: "Badge", props: { text: "$4.50", tone: "success" } },
        ],
      }),
    ]);
  });

  it("refuses Markup in the agent's own tree, even when it is valid", async () => {
    const { registry, ctx, shown } = await setupCustom();
    const markup = { component: "Markup", props: { root: { tag: "p", text: "Hi" } } };
    const result = await registry.run("render_ui", { tree: stack(markup) }, ctx);

    assert.deepEqual(result, {
      ok: false,
      summary: "UI has 1 problem",
      data: {
        errors: ["tree.children.0 Markup can only be used inside a custom component; define one with define_component"],
      },
    });
    assert.equal(shown.length, 0);
  });

  it("reports instance and template problems in the agent's terms", async () => {
    const { registry, ctx, shown } = await setupCustom();
    const result = await registry.run(
      "render_ui",
      {
        tree: stack(
          { component: "MenuItemCard", props: { name: "Latte", photo: latte.photo } },
          { component: "MenuItemCard", props: { ...latte, photo: "ftp://example.com/latte.jpg" } },
        ),
      },
      ctx,
    );

    assert.deepEqual(result.data, {
      errors: [
        "tree.children.0.props.price is required",
        'tree.children.1 (MenuItemCard v1) template.children.0.props.src must match pattern "^https?://"',
      ],
    });
    assert.equal(shown.length, 0);
  });

  it("refuses an unregistered action on a Markup button, and accepts clicks on a registered one", async () => {
    const { registry, repo, ctx, shown } = await setupCustom();
    await repo.save(orderForm("MailForm", "send_mail"));

    const refused = await registry.run("render_ui", { tree: stack({ component: "MailForm" }) }, ctx);
    assert.deepEqual(refused.data, {
      errors: [
        'tree.children.0 (MailForm v1) template.props.root.children.1.action "send_mail" is not a registered action' +
          " (call list_actions to see them)",
      ],
    });

    const rendered = await registry.run("render_ui", { tree: stack({ component: "OrderForm" }) }, ctx);
    assert.equal(rendered.ok, true);
    assert.deepEqual(names(shown[0]), ["Stack", "Markup"]);
    assert.deepEqual(checkActionRequest(shown[0], "place_order", { qty: "2" }), { ok: true });
  });

  it("refuses a deleted component in the agent's tree, and still expands templates that use it", async () => {
    const { registry, repo, ctx, shown } = await setupCustom();
    await repo.softDelete("MenuItemCard");
    const deleted =
      'tree.component "MenuItemCard" was deleted; restore it in the Components panel or use another component';

    const root = await registry.run("render_ui", { tree: { component: "MenuItemCard", props: latte } }, ctx);
    assert.deepEqual(root, { ok: false, summary: "UI has 1 problem", data: { errors: [deleted] } });
    const child = await registry.run("render_ui", { tree: stack({ component: "MenuItemCard", props: latte }) }, ctx);
    assert.deepEqual(child.data, { errors: [deleted.replace("tree", "tree.children.0")] });
    assert.equal(shown.length, 0);

    const result = await registry.run("render_ui", { tree: { component: "Specials", props: { price: "$3.00" } } }, ctx);
    assert.equal(result.ok, true);
    assert.deepEqual(names(shown[0]), ["Card", "Heading", "Card", "Image", "Heading", "Badge", "Divider"]);
  });

  it("keeps the agent's tree within 100 nodes and allows 400 expanded nodes and 24 levels", async () => {
    const { registry, repo, ctx } = await setupCustom();
    const dividers = Array.from({ length: 6 }, () => ({ component: "Divider" }));
    await repo.save(withTemplate("SixDividers", { component: "Stack", children: dividers }));
    const around = (child: TemplateNode | { $children: true }): TemplateNode => ({
      component: "Stack",
      children: [child],
    });
    await repo.save(withTemplate("ThreeLevels", around(around(around({ $children: true }))), "any"));
    const many = (count: number, component: string) => stack(...Array.from({ length: count }, () => ({ component })));

    const tooMany = await registry.run("render_ui", { tree: many(100, "Divider") }, ctx);
    assert.deepEqual(tooMany.data, { errors: ["tree has 101 nodes (max 100)"] });

    const wide = await registry.run("render_ui", { tree: many(57, "SixDividers") }, ctx);
    assert.equal(wide.summary, "Rendered 400 components");

    let deep: unknown = { component: "ThreeLevels" };
    for (let level = 2; level <= 8; level++) deep = { component: "ThreeLevels", children: [deep] };
    const result = await registry.run("render_ui", { tree: deep }, ctx);
    assert.equal(result.ok, true);
    assert.equal((result.data as { stats: { depth: number } }).stats.depth, 24);
  });

  it("suggests a custom name for an unknown one that differs only in case", async () => {
    const { registry, ctx } = await setupCustom();
    const tree = stack({ component: "menuItemCard" }, { component: "button" });
    const result = await registry.run("render_ui", { tree }, ctx);
    assert.deepEqual(result.data, {
      errors: [
        'tree.children.0.component "menuItemCard" is not in the catalog (did you mean MenuItemCard?)',
        'tree.children.1.component "button" is not in the catalog (did you mean Button?)',
      ],
    });
  });

  it("asks the repository nothing for a catalog-only design", async () => {
    const { registry, calls, ctx, shown } = await setupCustom();
    const tree = stack({ component: "Button", props: { label: "Go" } });
    const result = await registry.run("render_ui", { tree }, ctx);
    assert.equal(result.ok, true);
    assert.equal(shown.length, 1);
    assert.deepEqual(calls, []);
  });

  it("reports custom components unavailable only for designs that use names outside the catalog", async () => {
    const down = new InMemoryCustomComponentRepository();
    down.getByName = down.list = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const { registry, ctx, shown, errors } = await setupCustom(down);

    assert.equal((await registry.run("render_ui", { tree: stack({ component: "Divider" }) }, ctx)).ok, true);
    const result = await registry.run("render_ui", { tree: stack({ component: "MenuItemCard", props: latte }) }, ctx);
    assert.deepEqual(result, { ok: false, summary: "Custom components are unavailable" });
    assert.equal(shown.length, 1);
    assert.equal(errors.length, 1);
  });
});
