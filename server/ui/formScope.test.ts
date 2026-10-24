import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nearestCard, sendsInput } from "shared/formScope";

const tree = {
  component: "Stack",
  children: [
    { component: "TextInput", props: { name: "loose" } },
    {
      component: "Card",
      children: [
        { component: "TextInput", props: { name: "a" } },
        { component: "Card", children: [{ component: "TextInput", props: { name: "inner" } }] },
        { component: "Markup", props: { root: { tag: "div", children: [{ tag: "input" }, { tag: "button" }] } } },
        { component: "Button", props: { action: "go" } },
      ],
    },
  ],
};

describe("nearestCard", () => {
  it("finds the Card around a node, a nested node and a Markup element", () => {
    assert.equal(nearestCard(tree, "tree.children.1.children.0"), "tree.children.1");
    assert.equal(nearestCard(tree, "tree.children.1.children.1.children.0"), "tree.children.1.children.1");
    assert.equal(nearestCard(tree, "tree.children.1.children.2.props.root.children.0"), "tree.children.1");
  });

  it("is undefined outside every Card, and a Card is not its own ancestor", () => {
    assert.equal(nearestCard(tree, "tree.children.0"), undefined);
    assert.equal(nearestCard(tree, "tree"), undefined);
    assert.equal(nearestCard(tree, "tree.children.1"), undefined);
  });
});

describe("sendsInput", () => {
  it("sends everything inside the button's Card, including nested Cards", () => {
    const button = "tree.children.1.children.3";
    assert.equal(sendsInput(tree, button, "tree.children.1.children.0"), true);
    assert.equal(sendsInput(tree, button, "tree.children.1.children.1.children.0"), true);
    assert.equal(sendsInput(tree, button, "tree.children.0"), false);
    assert.equal(sendsInput(tree, "tree.children.1.children.1.children.1", "tree.children.1.children.0"), false);
  });

  it("sends every input when the button has no Card", () => {
    assert.equal(sendsInput(tree, "tree.children.0", "tree.children.1.children.0"), true);
  });
});
