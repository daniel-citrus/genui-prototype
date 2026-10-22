import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { Component } from "shared/components";
import { MAX_EXPANDED_NODES } from "shared/customComponents";
import { catalog as entries } from "../catalog/components";
import { InMemoryComponentRepository } from "../ports/fakes/InMemoryComponentRepository";
import { InMemoryCustomComponentRepository } from "../ports/fakes/InMemoryCustomComponentRepository";
import { validateUiTree } from "../ui/validateTree";
import { type Expansion, expandTree, rewritePaths } from "./expand";
import { barChart, menuItemCard, panel, specials, withTemplate } from "./testDefinitions";

const latte = { name: "Latte", price: "$4.50", photo: "https://example.com/latte.jpg" };
const text = (value: unknown) => ({ component: "Text", props: { text: value } });

describe("expandTree", () => {
  let catalog: Component[];
  let repo: InMemoryCustomComponentRepository;
  let resolved: string[];

  beforeEach(async () => {
    catalog = await new InMemoryComponentRepository(entries).list();
    repo = new InMemoryCustomComponentRepository();
    resolved = [];
    for (const definition of [menuItemCard, barChart, panel, specials]) await repo.save(definition);
  });

  const expand = (tree: unknown) =>
    expandTree(tree, {
      catalog,
      resolve: (name) => {
        resolved.push(name);
        return repo.getByName(name);
      },
    });

  /** Validator errors on the expanded tree, in the agent's terms. */
  const validatorErrors = (expansion: Expansion) =>
    rewritePaths(validateUiTree(expansion.tree, catalog).errors, expansion.origins);

  it("fills props, uses schema defaults and leaves out unset optional props", async () => {
    const result = await expand({ component: "Stack", children: [{ component: "MenuItemCard", props: latte }] });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.tree, {
      component: "Stack",
      children: [
        {
          component: "Card",
          props: {},
          children: [
            { component: "Image", props: { src: latte.photo, alt: "Latte" } },
            { component: "Heading", props: { text: "Latte", level: 3 } },
            { component: "Badge", props: { text: "$4.50", tone: "success" } },
          ],
        },
      ],
    });
    assert.deepEqual([...result.origins], [["tree.children.0", "tree.children.0 (MenuItemCard v1) template"]]);
    assert.deepEqual(validatorErrors(result), []);
  });

  it("fills Markup text, attribute and style values", async () => {
    await repo.save({
      ...barChart,
      template: {
        component: "Markup",
        props: {
          root: {
            tag: "div",
            style: { color: { $prop: "color" } },
            text: { $prop: "label" },
            attrs: { title: { $prop: "missing" } },
          },
        },
      },
    });
    const result = await expand({ component: "BarChart", props: { label: "Sales", value: 60 } });
    assert.deepEqual(result.tree, {
      component: "Markup",
      props: { root: { tag: "div", style: { color: "#0ea5e9" }, text: "Sales", attrs: {} } },
    });

    await repo.save(barChart);
    const chart = await expand({ component: "BarChart", props: { label: "Sales", value: 60 } });
    const root = (chart.tree?.props as { root: { attrs: unknown; children: unknown[] } }).root;
    assert.deepEqual(root.attrs, { viewBox: "0 0 100 20", width: 200, height: 40, "aria-label": "Sales" });
    assert.deepEqual(root.children[0], { tag: "title", text: "Sales" });
    assert.deepEqual(root.children[2], { tag: "rect", attrs: { width: 60, height: 20, fill: "#0ea5e9" } });
    assert.deepEqual(validatorErrors(chart), []);
  });

  it("splices the instance's children into the slot and maps them back to the agent's paths", async () => {
    const result = await expand({
      component: "Panel",
      props: { title: "Today" },
      children: [text("Open late"), text(5)],
    });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.tree, {
      component: "Card",
      children: [
        { component: "Heading", props: { text: "Today" } },
        text("Open late"),
        text(5),
        { component: "Divider" },
      ],
    });
    assert.deepEqual(validatorErrors(result), ["tree.children.1.props.text must be string"]);
  });

  it("expands custom components used inside templates", async () => {
    const result = await expand({ component: "Specials", props: { price: "$3.00" } });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.tree, {
      component: "Card",
      children: [
        { component: "Heading", props: { text: "Specials" } },
        {
          component: "Card",
          props: {},
          children: [
            { component: "Image", props: { src: "https://example.com/mocha.jpg", alt: "Mocha" } },
            { component: "Heading", props: { text: "Mocha", level: 3 } },
            { component: "Badge", props: { text: "$3.00", tone: "success" } },
          ],
        },
        { component: "Divider" },
      ],
    });
    assert.equal(
      result.origins.get("tree.children.1"),
      "tree (Specials v1) template.children.0 (MenuItemCard v1) template",
    );
  });

  it("refuses bad instance props and children with the agent's paths and leaves the node out", async () => {
    const result = await expand({
      component: "Stack",
      children: [
        { component: "MenuItemCard", props: { name: 5, size: "lg" } },
        { component: "MenuItemCard", props: latte, children: [] },
        { component: "Panel", props: "Today", extra: true },
        text(5),
      ],
    });
    assert.deepEqual(result.errors, [
      "tree.children.0.props.price is required",
      "tree.children.0.props.photo is required",
      "tree.children.0.props.size is not allowed",
      "tree.children.0.props.name must be string",
      "tree.children.1 MenuItemCard cannot have children",
      "tree.children.2.extra is not allowed (use component, props, children)",
      "tree.children.2.props must be an object",
    ]);
    assert.deepEqual(result.tree, { component: "Stack", children: [text(5)] });
    // The Text moved up to children.0; its problem still names the agent's node.
    assert.deepEqual(validatorErrors(result), ["tree.children.3.props.text must be string"]);
  });

  it("refuses a deleted component in the agent's tree but expands one used inside a template", async () => {
    await repo.softDelete("MenuItemCard");
    const own = await expand({ component: "Stack", children: [{ component: "MenuItemCard", props: latte }] });
    assert.deepEqual(own.errors, [
      'tree.children.0.component "MenuItemCard" was deleted; restore it in the Components panel or use another component',
    ]);
    assert.deepEqual(own.tree, { component: "Stack", children: [] });

    const used = await expand({ component: "Specials", props: { price: "$3.00" } });
    assert.deepEqual(used.errors, []);
    assert.equal((used.tree?.children?.[1] as { component: string }).component, "Card");
  });

  it("stops with an error on a loop that appears through an update", async () => {
    await repo.save(withTemplate("Inner", text("inner")));
    await repo.save(withTemplate("Outer", { component: "Stack", children: [{ component: "Inner" }] }));
    await repo.save(withTemplate("Inner", { component: "Outer" }));

    const result = await expand({ component: "Outer" });
    assert.deepEqual(result.errors, [
      'tree (Outer v1) template.children.0 (Inner v2) template.component "Outer" makes a loop: Outer → Inner → Outer',
    ]);
    assert.deepEqual(result.tree, { component: "Stack", children: [] });
  });

  it("stops past three levels of custom inside custom", async () => {
    await repo.save(withTemplate("Level4", text("deep")));
    await repo.save(withTemplate("Level3", { component: "Stack", children: [{ component: "Level4" }] }));
    await repo.save(withTemplate("Level2", { component: "Stack", children: [{ component: "Level3" }] }));
    await repo.save(withTemplate("Level1", { component: "Stack", children: [{ component: "Level2" }] }));

    const result = await expand({ component: "Level1" });
    assert.equal(result.errors.length, 1);
    assert.match(
      result.errors[0],
      /\.component "Level4" nests custom components 4 levels deep \(max 3\): Level1 → Level2 → Level3 → Level4$/,
    );
  });

  it("returns a null tree when the root itself is refused", async () => {
    const result = await expand({ component: "MenuItemCard" });
    assert.equal(result.tree, null);
    assert.equal(result.errors.length, 3);
  });

  it("stops expanding once the tree reaches the node limit", async () => {
    await repo.save(withTemplate("Big", { component: "Stack", children: Array.from({ length: 39 }, () => text("x")) }));
    const bigs = Array.from({ length: 12 }, () => ({ component: "Big" }));
    const result = await expand({ component: "Stack", children: bigs });
    assert.deepEqual(result.errors, [
      `tree.children.10 was not expanded: the expanded tree reached ${MAX_EXPANDED_NODES} nodes (max)`,
    ]);
    assert.equal(result.tree?.children?.length, 10);
  });

  it("leaves unknown names as they are, and expands custom components inside them", async () => {
    const result = await expand({ component: "Nope", children: [{ component: "MenuItemCard", props: latte }] });
    assert.deepEqual(result.errors, []);
    assert.equal(result.tree?.component, "Nope");
    assert.equal(result.tree?.children?.[0].component, "Card");
    assert.deepEqual(validatorErrors(result), ['tree.component "Nope" is not in the catalog']);
  });

  it("copies catalog components as they are without looking up custom ones", async () => {
    await repo.save(withTemplate("Badge", text("shadowed")));
    const tree = {
      component: "Stack",
      children: [{ component: "Badge", props: { text: "New" } }, { component: "Divider" }],
    };
    const result = await expand(tree);
    assert.deepEqual(result.tree, tree);
    assert.deepEqual(resolved, []);
  });

  it("looks up each custom name once per expansion", async () => {
    await expand({
      component: "Stack",
      children: [
        { component: "Specials", props: { price: "$1" } },
        { component: "Panel", props: { title: "A" } },
      ],
    });
    assert.deepEqual(resolved, ["Specials", "Panel", "MenuItemCard"]);
  });
});

describe("rewritePaths", () => {
  const origins = new Map([
    ["tree.children.0", "tree.children.0 (MenuItemCard v3) template"],
    ["tree.children.0.children.2", "tree.children.0.children.1"],
    ["tree.children.1", "tree.children.4 (Panel v1) template"],
  ]);

  it("replaces the longest matching path prefix", () => {
    assert.deepEqual(
      rewritePaths(
        [
          "tree.children.0.children.1.props.text must be string",
          "tree.children.0.children.2.props.text must be string",
          "tree.children.0 Card cannot have children",
          "tree.children.10.props.text must be string",
          "tree has 500 nodes (max 400)",
        ],
        origins,
      ),
      [
        "tree.children.0 (MenuItemCard v3) template.children.1.props.text must be string",
        "tree.children.0.children.1.props.text must be string",
        "tree.children.0 (MenuItemCard v3) template Card cannot have children",
        "tree.children.10.props.text must be string",
        "tree has 500 nodes (max 400)",
      ],
    );
  });

  it("also rewrites a second path later in the message", () => {
    assert.deepEqual(
      rewritePaths(['tree.children.1.children.0.props.name "qty" is already used by tree.children.0.children.3'], origins),
      [
        'tree.children.4 (Panel v1) template.children.0.props.name "qty" is already used by tree.children.0 (MenuItemCard v3) template.children.3',
      ],
    );
  });
});
