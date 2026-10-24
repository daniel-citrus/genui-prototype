import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TemplateNode } from "shared/customComponents";
import type { UiNode } from "shared/ui";
import { createActions } from "../actions/index";
import { createMenuActions } from "../actions/menu/index";
import { createActionRegistry } from "../actions/registry";
import type { ActionSpec } from "../actions/types";
import { items } from "../adapters/pos/fixtures";
import { createInMemoryPosMenu } from "../adapters/pos/InMemoryPosMenu";
import { catalog } from "../catalog/components";
import { InMemoryComponentRepository } from "../ports/fakes/InMemoryComponentRepository";
import { menuItemCard, panel, specials, withTemplate } from "../customComponents/testDefinitions";
import { InMemoryCustomComponentRepository } from "../ports/fakes/InMemoryCustomComponentRepository";
import type { CustomComponentRepository } from "../ports/CustomComponentRepository";
import { checkActionRequest } from "../ui/checkAction";
import { checkDesign, CustomComponentsUnavailableError, type DesignCheckDeps } from "./checkDesign";

const catalogComponents = await new InMemoryComponentRepository(catalog).list();

function setup(overrides: Partial<DesignCheckDeps> = {}) {
  const errors: object[] = [];
  const deps: DesignCheckDeps = {
    catalog: catalogComponents,
    actions: [],
    log: { info() {}, debug() {}, warn() {}, error: (obj) => void errors.push(obj) },
    signal: new AbortController().signal,
    ...overrides,
  };
  return { deps, errors, check: (tree: unknown) => checkDesign(tree, deps) };
}

const problemsOf = (result: Awaited<ReturnType<typeof checkDesign>>): string[] => {
  assert.equal(result.ok, false);
  return result.ok ? [] : result.problems;
};

const stack = (...children: unknown[]) => ({ component: "Stack", children });
const names = (node: UiNode): string[] => [node.component, ...(node.children ?? []).flatMap(names)];

describe("checkDesign", () => {
  it("returns the tree without empty children arrays and the stats, leaving the input as sent", async () => {
    const tree = { component: "Heading", props: { text: "Hi" }, children: [] };
    const result = await setup().check(tree);

    assert.deepEqual(result, {
      ok: true,
      tree: { component: "Heading", props: { text: "Hi" } },
      stats: { nodes: 1, depth: 1, components: { Heading: 1 } },
    });
    assert.deepEqual(tree.children, []);
    assert.equal((await setup().check({ ...tree, children: [{ component: "Divider" }] })).ok, false);
  });

  it("returns the problems of an invalid tree", async () => {
    const result = await setup().check(stack({ component: "Button" }, { component: "button" }));
    assert.deepEqual(problemsOf(result), [
      "tree.children.0.props.label is required (call get_component Button for its props)",
      'tree.children.1.component "button" is not in the catalog (did you mean Button?)',
    ]);
  });

  it("reports at most 20 problems", async () => {
    const result = await setup().check(stack(...Array.from({ length: 30 }, () => ({ component: "Nope" }))));
    assert.equal(problemsOf(result).length, 20);
  });

  it("refuses a Button bound to an unregistered action", async () => {
    const actions: ActionSpec[] = [
      {
        name: "demo_echo",
        description: "Echo.",
        input_schema: { type: "object", properties: {}, additionalProperties: false },
      },
    ];
    const { check } = setup({ actions });
    const go = (action: string) => ({ component: "Button", props: { label: "Go", action } });

    assert.deepEqual(problemsOf(await check(go("send_mail"))), [
      'tree.props.action "send_mail" is not a registered action (call list_actions to see them)',
    ]);
    assert.equal((await check(go("demo_echo"))).ok, true);
  });
});

describe("checkDesign with the menu actions", () => {
  const itemNames = items.map((i) => i.name);
  const registry = createActionRegistry([...createActions(), ...createMenuActions(createInMemoryPosMenu())]);
  const form = (itemOptions: string[], withFields = true) => ({
    component: "Card",
    children: [
      { component: "Select", props: { label: "Item", name: "item", options: itemOptions } },
      ...(withFields
        ? [
            { component: "TextInput", props: { label: "New name", name: "name" } },
            { component: "TextInput", props: { label: "New description", name: "description" } },
          ]
        : []),
      { component: "Button", props: { label: "Save", action: "menu_update_item" } },
    ],
  });
  const menu = () => setup({ actions: registry.specs, listChoices: registry.listChoices });

  it("accepts an edit-item form over the demo items", async () => {
    const result = await menu().check(form(itemNames));
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  it("refuses an item option the menu doesn't have", async () => {
    assert.deepEqual(problemsOf(await menu().check(form([...itemNames, "Latte"]))), [
      'tree.children.0.props.options "Latte" is not one of the menu_items values (call list_actions to get them)',
    ]);
  });

  it("refuses an edit form with nothing to change", async () => {
    assert.deepEqual(problemsOf(await menu().check(form(itemNames, false))), [
      'tree.children.1 action "menu_update_item" changes nothing without an input for one of: name, description, category',
    ]);
  });

  it("refuses a Select that is disabled and has no value", async () => {
    const tree = { component: "Select", props: { label: "Item", name: "item", options: ["A"], disabled: true } };
    const result = await menu().check(tree);
    assert.equal(result.ok, false);
  });
});

describe("checkDesign dropdown checks", () => {
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
    const loads: string[] = [];
    const signal = new AbortController().signal;
    const listChoices = async (source: string, given: AbortSignal) => {
      assert.equal(given, signal);
      loads.push(source);
      if (failing.includes(source)) throw new Error(`${source} is down`);
      return values[source];
    };
    return { ...setup({ actions: menuActions, listChoices, signal }), loads };
  }

  const select = (name: string, ...options: string[]) => ({
    component: "Select",
    props: { label: name, options, name },
  });
  const button = (action: string) => ({ component: "Button", props: { label: "Go", action } });

  it("loads each source once per call, even when several inputs and actions use it", async () => {
    const { check, loads } = setupChoices();
    const tree = stack(
      select("item", "Bạc xỉu"),
      select("into", "Cà phê sữa đá"),
      select("category", "Tea"),
      button("menu_update_item"),
      button("menu_merge_items"),
    );
    assert.equal((await check(tree)).ok, true);
    assert.deepEqual(loads.toSorted(), ["menu_categories", "menu_items"]);
    assert.equal((await check(tree)).ok, true);
    assert.equal(loads.length, 4);
  });

  it("refuses an option the source doesn't have", async () => {
    const { check } = setupChoices();
    const result = await check(stack(select("item", "Latte"), select("category", "Tea"), button("menu_update_item")));
    assert.deepEqual(problemsOf(result), [
      'tree.children.0.props.options "Latte" is not one of the menu_items values (call list_actions to get them)',
    ]);
  });

  it("skips a source that fails to load, logs it, and still checks the rest", async () => {
    const { check, errors } = setupChoices(["menu_categories"]);
    const result = await check(stack(select("item", "Latte"), select("category", "Juice"), button("menu_update_item")));
    assert.deepEqual(problemsOf(result), [
      'tree.children.0.props.options "Latte" is not one of the menu_items values (call list_actions to get them)',
    ]);
    assert.equal(errors.length, 1);
    assert.equal((errors[0] as { source?: string }).source, "menu_categories");
  });

  it("loads only sources of inputs in the tree whose action some Button names", async () => {
    const { check, loads } = setupChoices();
    await check(stack(select("item", "Latte"), button("menu_update_item")));
    await check(stack(select("item", "Latte"), select("category", "Juice")));
    assert.deepEqual(loads, ["menu_items"]);
  });

  it("checks no dropdowns without listChoices", async () => {
    const { check } = setup({ actions: menuActions });
    const tree = stack(select("item", "Latte"), select("category", "Juice"), button("menu_update_item"));
    assert.equal((await check(tree)).ok, true);
  });
});

describe("checkDesign with custom components", () => {
  const latte = { name: "Latte", price: "$4.50", photo: "https://example.com/latte.jpg" };
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

  /** `check` over the test definitions, or over `customComponents`; `calls` lists what the repository was asked. */
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
    return { repo, calls, ...setup({ actions: [placeOrder], customComponents: customComponents ?? repo }) };
  }

  const shownTree = async (result: Promise<Awaited<ReturnType<typeof checkDesign>>>): Promise<UiNode> => {
    const done = await result;
    assert.equal(done.ok, true, JSON.stringify(done));
    return done.ok ? done.tree : { component: "" };
  };

  it("validates the expanded tree and counts its nodes", async () => {
    const { check } = await setupCustom();
    const result = await check(stack({ component: "MenuItemCard", props: latte }));

    assert.deepEqual(result, {
      ok: true,
      stats: { nodes: 5, depth: 3, components: { Stack: 1, Card: 1, Image: 1, Heading: 1, Badge: 1 } },
      tree: stack({
        component: "Card",
        props: {},
        children: [
          { component: "Image", props: { src: latte.photo, alt: "Latte" } },
          { component: "Heading", props: { text: "Latte", level: 3 } },
          { component: "Badge", props: { text: "$4.50", tone: "success" } },
        ],
      }),
    });
  });

  it("accepts a custom none instance with an empty children array and refuses a non-empty one", async () => {
    const { check } = await setupCustom();
    const card = { component: "MenuItemCard", props: latte };
    assert.equal(names(await shownTree(check(stack({ ...card, children: [] })))).includes("Card"), true);
    assert.deepEqual(problemsOf(await check(stack({ ...card, children: [{ component: "Divider" }] }))), [
      "tree.children.0 MenuItemCard cannot have children",
    ]);
  });

  it("drops an empty children array on a leaf that came out of a stored template", async () => {
    const { check, repo } = await setupCustom();
    await repo.save(withTemplate("Greeting", { component: "Heading", props: { text: "Hi" }, children: [] }));
    assert.deepEqual(await shownTree(check(stack({ component: "Greeting" }))), stack({ component: "Heading", props: { text: "Hi" } }));
  });

  it("accepts Markup in the design and refuses Markup that breaks the allowlist", async () => {
    const { check } = await setupCustom();
    const markup = { component: "Markup", props: { root: { tag: "ul", children: [{ tag: "li", text: "A" }] } } };
    assert.deepEqual(await shownTree(check(stack(markup))), stack(markup));

    const draw = (root: unknown) => check(stack({ component: "Markup", props: { root } }));
    assert.match(
      problemsOf(await draw({ tag: "script", text: "x" }))[0],
      /^tree\.children\.0\.props\.root\.tag "script" is not allowed/,
    );
    assert.match(problemsOf(await draw({ tag: "p", attrs: { onclick: "x()" } }))[0], /onclick/);
  });

  it("refuses Markup input, select and button at any depth in the design", async () => {
    const { check } = await setupCustom();
    for (const tag of ["input", "select", "button"]) {
      const root = { tag: "div", children: [{ tag: "p", children: [{ tag }] }] };
      assert.deepEqual(problemsOf(await check(stack({ component: "Markup", props: { root } }))), [
        `tree.children.0 Markup ${tag} can't be used directly in a design; use TextInput, Checkbox, Select or Button, or put it in a custom component template`,
      ]);
    }
  });

  it("reports instance and template problems in the design's terms", async () => {
    const { check } = await setupCustom();
    const result = await check(
      stack(
        { component: "MenuItemCard", props: { name: "Latte", photo: latte.photo } },
        { component: "MenuItemCard", props: { ...latte, photo: "ftp://example.com/latte.jpg" } },
      ),
    );
    assert.deepEqual(problemsOf(result), [
      "tree.children.0.props.price is required (call get_component MenuItemCard for its props)",
      'tree.children.1 (MenuItemCard v1) template.children.0.props.src must match pattern "^https?://"' +
        " (call get_component Image for its props)",
    ]);
  });

  it("refuses an unregistered action on a Markup button, and accepts clicks on a registered one", async () => {
    const { check, repo } = await setupCustom();
    await repo.save(orderForm("MailForm", "send_mail"));

    assert.deepEqual(problemsOf(await check(stack({ component: "MailForm" }))), [
      'tree.children.0 (MailForm v1) template.props.root.children.1.action "send_mail" is not a registered action' +
        " (call list_actions to see them)",
    ]);
    const tree = await shownTree(check(stack({ component: "OrderForm" })));
    assert.deepEqual(names(tree), ["Stack", "Markup"]);
    assert.deepEqual(checkActionRequest(tree, "place_order", { qty: "2" }), { ok: true });
  });

  it("refuses a deleted component in the design, and still expands templates that use it", async () => {
    const { check, repo } = await setupCustom();
    await repo.softDelete("MenuItemCard");
    const deleted =
      'tree.component "MenuItemCard" was deleted; restore it in the Components panel or use another component';

    assert.deepEqual(problemsOf(await check({ component: "MenuItemCard", props: latte })), [deleted]);
    assert.deepEqual(problemsOf(await check(stack({ component: "MenuItemCard", props: latte }))), [
      deleted.replace("tree", "tree.children.0"),
    ]);
    const tree = await shownTree(check({ component: "Specials", props: { price: "$3.00" } }));
    assert.deepEqual(names(tree), ["Card", "Heading", "Card", "Image", "Heading", "Badge", "Divider"]);
  });

  it("keeps the design within 100 nodes and allows 400 expanded nodes and 24 levels", async () => {
    const { check, repo } = await setupCustom();
    const dividers = Array.from({ length: 6 }, () => ({ component: "Divider" }));
    await repo.save(withTemplate("SixDividers", { component: "Stack", children: dividers }));
    const around = (child: TemplateNode | { $children: true }): TemplateNode => ({
      component: "Stack",
      children: [child],
    });
    await repo.save(withTemplate("ThreeLevels", around(around(around({ $children: true }))), "any"));
    const many = (count: number, component: string) => stack(...Array.from({ length: count }, () => ({ component })));

    assert.deepEqual(problemsOf(await check(many(100, "Divider"))), [
      "tree has 101 nodes (max 100); simplify the design or reuse a listed custom component, where each use counts as one node",
    ]);

    const wide = await check(many(57, "SixDividers"));
    assert.equal(wide.ok && wide.stats.nodes, 400);

    let deep: unknown = { component: "ThreeLevels" };
    for (let level = 2; level <= 8; level++) deep = { component: "ThreeLevels", children: [deep] };
    const result = await check(deep);
    assert.equal(result.ok && result.stats.depth, 24);

    let tooDeep: unknown = { component: "ThreeLevels" };
    for (let level = 2; level <= 9; level++) tooDeep = { component: "ThreeLevels", children: [tooDeep] };
    assert.equal((await check(tooDeep)).ok, false);
  });

  it("does not tell the reader to define a custom component when the design has too many nodes", async () => {
    const { check } = await setupCustom();
    const [message] = problemsOf(await check(stack(...Array.from({ length: 100 }, () => ({ component: "Divider" })))));
    assert.doesNotMatch(message, /put the repeated part|define/);
  });

  it("suggests a custom name for an unknown one that differs only in case", async () => {
    const { check } = await setupCustom();
    assert.deepEqual(problemsOf(await check(stack({ component: "menuItemCard" }, { component: "button" }))), [
      'tree.children.0.component "menuItemCard" is not in the catalog (did you mean MenuItemCard?)',
      'tree.children.1.component "button" is not in the catalog (did you mean Button?)',
    ]);
  });

  it("asks the repository nothing for a catalog-only design", async () => {
    const { check, calls } = await setupCustom();
    assert.equal((await check(stack({ component: "Button", props: { label: "Go" } }))).ok, true);
    assert.deepEqual(calls, []);
  });

  it("rejects with CustomComponentsUnavailableError only for designs that use names outside the catalog", async () => {
    const down = new InMemoryCustomComponentRepository();
    down.getByName = down.list = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const { check, errors } = await setupCustom(down);

    assert.equal((await check(stack({ component: "Divider" }))).ok, true);
    await assert.rejects(check(stack({ component: "MenuItemCard", props: latte })), CustomComponentsUnavailableError);
    assert.equal(errors.length, 1);
  });

  it("refuses $each in the design but expands it in a saved list", async () => {
    const { check, repo } = await setupCustom();
    const bulletList = {
      ...withTemplate("BulletList", {
        component: "Markup",
        props: { root: { tag: "ul", children: [{ $each: "items", as: { tag: "li", text: { $item: true } } }] } },
      }),
      propsSchema: {
        type: "object" as const,
        properties: { items: { type: "array", items: { type: "string" }, description: "The items." } },
        additionalProperties: false as const,
      },
      exampleProps: { items: ["A"] },
    };
    await repo.save(bulletList);
    const tree = await shownTree(check(stack({ component: "BulletList", props: { items: ["A", "B", "C"] } })));
    const root = tree.children?.[0].props?.root as { children: { tag: string; text: string }[] };
    assert.deepEqual(
      root.children.map((c) => [c.tag, c.text]),
      [["li", "A"], ["li", "B"], ["li", "C"]],
    );
    assert.equal((await check(stack({ $each: "items", as: { component: "Divider" } }))).ok, false);
  });
});
