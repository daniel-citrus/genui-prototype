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
      ],
    };
    assert.deepEqual(collectBindings(tree), { inputs: [], buttons: [] });
    assert.deepEqual(collectBindings("nope"), { inputs: [], buttons: [] });
  });
});
