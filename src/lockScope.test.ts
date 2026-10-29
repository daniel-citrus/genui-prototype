import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UiNode } from "shared/ui";
import { lockScope } from "./lockScope";

const button: UiNode = { component: "Button", props: { label: "Save", action: "demo_echo" } };
const card: UiNode = { component: "Card", children: [{ component: "TextInput", props: { name: "text" } }, button] };

/** Two Cards side by side, each with its own Save button. */
const cards: UiNode = { component: "Stack", children: [card, card] };

describe("lockScope", () => {
  it("locks the whole design when the button has no Card", () => {
    const tree: UiNode = { component: "Stack", children: [button] };
    assert.equal(lockScope(tree, "tree.children.0", undefined), "tree");
    assert.equal(lockScope(tree, "tree.children.0", []), "tree");
  });

  it("locks the button's Card when nothing went stale", () => {
    assert.equal(lockScope(cards, "tree.children.1.children.1", undefined), "tree.children.1");
    assert.equal(lockScope(cards, "tree.children.1.children.1", []), "tree.children.1");
  });

  it("locks the button's Card when only that Card went stale", () => {
    assert.equal(lockScope(cards, "tree.children.1.children.1", ["tree.children.1"]), "tree.children.1");
  });

  it("locks the whole design when another Card went stale", () => {
    assert.equal(lockScope(cards, "tree.children.1.children.1", ["tree.children.0"]), "tree");
    assert.equal(lockScope(cards, "tree.children.1.children.1", ["tree.children.1", "tree.children.0"]), "tree");
  });

  it("locks the whole design when a dropdown outside every Card went stale", () => {
    assert.equal(lockScope(cards, "tree.children.1.children.1", ["tree"]), "tree");
  });

  it("locks the Card holding a Markup button", () => {
    const markup: UiNode = {
      component: "Card",
      children: [{ component: "Markup", props: { root: { tag: "button", action: "demo_echo", text: "Go" } } }],
    };
    const tree: UiNode = { component: "Stack", children: [markup] };
    assert.equal(lockScope(tree, "tree.children.0.children.0.props.root", []), "tree.children.0");
  });
});
