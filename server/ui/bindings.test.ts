import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectBindings } from "./bindings";

describe("collectBindings", () => {
  it("lists named inputs and action Buttons in document order with their paths", () => {
    const tree = {
      component: "Card",
      children: [
        { component: "TextInput", props: { label: "Email", name: "email" } },
        { component: "TextInput", props: { label: "Code", name: "code", type: "password" } },
        {
          component: "Stack",
          children: [
            { component: "Select", props: { label: "Plan", options: ["Free", 3, "Pro"], name: "plan" } },
            { component: "Checkbox", props: { label: "Updates", name: "updates" } },
            { component: "Button", props: { label: "Go", action: "sign_up" } },
            { component: "Button", props: { label: "Later", action: "sign_up", disabled: true } },
          ],
        },
      ],
    };
    assert.deepEqual(collectBindings(tree), {
      inputs: [
        { path: "tree.children.0", component: "TextInput", name: "email", type: "text", card: "tree" },
        { path: "tree.children.1", component: "TextInput", name: "code", type: "password", card: "tree" },
        { path: "tree.children.2.children.0", component: "Select", name: "plan", options: ["Free", "Pro"], card: "tree" },
        { path: "tree.children.2.children.1", component: "Checkbox", name: "updates", card: "tree" },
      ],
      buttons: [
        { path: "tree.children.2.children.2", action: "sign_up", disabled: false, card: "tree" },
        { path: "tree.children.2.children.3", action: "sign_up", disabled: true, card: "tree" },
      ],
    });
  });

  it("finds named inputs, selects with their options and action buttons inside Markup roots", () => {
    const root = {
      tag: "div",
      children: [
        { tag: "label", text: "Qty", children: [{ tag: "input", attrs: { name: "qty", type: "number" } }] },
        { tag: "input", attrs: { name: "note" } },
        { tag: "input", attrs: { name: "gift", type: "checkbox" } },
        {
          tag: "select",
          attrs: { name: "size" },
          children: [
            { tag: "option", attrs: { value: "s" }, text: "Small" },
            { tag: "option", text: "Large" },
            { tag: "option", attrs: { value: 3 } },
            { tag: "span", text: "Not an option" },
            { tag: "option" },
          ],
        },
        { tag: "button", action: "order", text: "Order" },
        { tag: "button", action: "cancel", attrs: { disabled: true } },
        { tag: "button", attrs: { disabled: true } },
        { tag: "div", action: "not_a_button" },
        { tag: "input", attrs: { name: { $prop: "field" } } },
      ],
    };
    const tree = {
      component: "Stack",
      children: [
        { component: "TextInput", props: { label: "Email", name: "email" } },
        { component: "Card", children: [{ component: "Markup", props: { root } }] },
        { component: "Button", props: { label: "Go", action: "go" } },
      ],
    };
    const at = "tree.children.1.children.0.props.root.children";
    assert.deepEqual(collectBindings(tree), {
      inputs: [
        { path: "tree.children.0", component: "TextInput", name: "email", type: "text" },
        { path: `${at}.0.children.0`, component: "TextInput", name: "qty", type: "number", markup: true, card: "tree.children.1" },
        { path: `${at}.1`, component: "TextInput", name: "note", type: "text", markup: true, card: "tree.children.1" },
        { path: `${at}.2`, component: "Checkbox", name: "gift", markup: true, card: "tree.children.1" },
        { path: `${at}.3`, component: "Select", name: "size", options: ["s", "Large", "3"], markup: true, card: "tree.children.1" },
      ],
      buttons: [
        { path: `${at}.4`, action: "order", disabled: false, markup: true, card: "tree.children.1" },
        { path: `${at}.5`, action: "cancel", disabled: true, markup: true, card: "tree.children.1" },
        { path: "tree.children.2", action: "go", disabled: false },
      ],
    });
  });

  it("keeps a Select's preset value and its disabled flag", () => {
    const tree = {
      component: "Stack",
      children: [
        { component: "Select", props: { label: "Item", name: "item", options: ["Tea"], value: "Tea", disabled: true } },
        { component: "Select", props: { label: "Size", name: "size", options: ["S"], value: 3, disabled: false } },
      ],
    };
    assert.deepEqual(collectBindings(tree).inputs, [
      { path: "tree.children.0", component: "Select", name: "item", options: ["Tea"], value: "Tea", disabled: true },
      { path: "tree.children.1", component: "Select", name: "size", options: ["S"] },
    ]);
  });

  it("records the Tabs panels and Collapsibles around each binding, outermost first", () => {
    const named = (name: string) => ({ component: "TextInput", props: { label: name, name } });
    const tabs = {
      component: "Tabs",
      props: { labels: ["One", "Two"] },
      children: [
        named("first"),
        {
          component: "Card",
          children: [
            {
              component: "Collapsible",
              props: { title: "More" },
              children: [{ component: "Markup", props: { root: { tag: "input", attrs: { name: "note" } } } }],
            },
            { component: "Button", props: { label: "Go", action: "go" } },
          ],
        },
      ],
    };
    const { inputs, buttons } = collectBindings({ component: "Stack", children: [tabs, named("outside")] });
    assert.deepEqual(
      [...inputs, ...buttons].map(({ path, panels }) => ({ path, panels })),
      [
        { path: "tree.children.0.children.0", panels: ["tree.children.0.children.0"] },
        {
          path: "tree.children.0.children.1.children.0.children.0.props.root",
          panels: ["tree.children.0.children.1", "tree.children.0.children.1.children.0"],
        },
        { path: "tree.children.1", panels: undefined },
        { path: "tree.children.0.children.1.children.1", panels: ["tree.children.0.children.1"] },
      ],
    );
  });

  it("skips unbound nodes, other components and malformed values", () => {
    const tree = {
      component: "Stack",
      children: [
        { component: "Button", props: { label: "Plain" } },
        { component: "TextInput", props: { label: "Unnamed" } },
        { component: "Heading", props: { text: "x", name: "heading" } },
        { component: "Checkbox", props: { label: "Bad", name: 7 } },
        7,
        { component: "Button", props: [] },
        { component: "Markup", props: { root: "<input name=x>" } },
        { component: "Markup", props: { root: { tag: "input", attrs: [], children: {} } } },
      ],
    };
    assert.deepEqual(collectBindings(tree), { inputs: [], buttons: [] });
    assert.deepEqual(collectBindings("nope"), { inputs: [], buttons: [] });
  });
});
