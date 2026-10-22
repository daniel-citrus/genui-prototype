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
        { path: "tree.children.0", component: "TextInput", name: "email", type: "text" },
        { path: "tree.children.1", component: "TextInput", name: "code", type: "password" },
        { path: "tree.children.2.children.0", component: "Select", name: "plan", options: ["Free", "Pro"] },
        { path: "tree.children.2.children.1", component: "Checkbox", name: "updates" },
      ],
      buttons: [
        { path: "tree.children.2.children.2", action: "sign_up", disabled: false },
        { path: "tree.children.2.children.3", action: "sign_up", disabled: true },
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
        { path: `${at}.0.children.0`, component: "TextInput", name: "qty", type: "number", markup: true },
        { path: `${at}.1`, component: "TextInput", name: "note", type: "text", markup: true },
        { path: `${at}.2`, component: "Checkbox", name: "gift", markup: true },
        { path: `${at}.3`, component: "Select", name: "size", options: ["s", "Large", "3"], markup: true },
      ],
      buttons: [
        { path: `${at}.4`, action: "order", disabled: false, markup: true },
        { path: `${at}.5`, action: "cancel", disabled: true, markup: true },
        { path: "tree.children.2", action: "go", disabled: false },
      ],
    });
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
