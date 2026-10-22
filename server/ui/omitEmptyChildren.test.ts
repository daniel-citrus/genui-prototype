import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { omitEmptyChildren } from "./omitEmptyChildren";

const childrenOf = (name: string) => ({ Heading: "none", Markup: "none", Stack: "any" })[name] as "none" | "any" | undefined;

describe("omitEmptyChildren", () => {
  it("drops an empty children array from a leaf without mutating the input", () => {
    const node = { component: "Heading", props: { text: "Hi" }, children: [] };
    assert.deepEqual(omitEmptyChildren(node, childrenOf), { component: "Heading", props: { text: "Hi" } });
    assert.deepEqual(node.children, []);
  });

  it("keeps an empty array on a Stack and on an unknown name", () => {
    for (const component of ["Stack", "Nope"]) {
      assert.deepEqual(omitEmptyChildren({ component, children: [] }, childrenOf), { component, children: [] });
    }
  });

  it("strips a leaf nested under a Stack and copies children element by element", () => {
    const node = {
      component: "Stack",
      children: [{ component: "Heading", children: [] }, { component: "Stack", children: [] }],
    };
    const result = omitEmptyChildren(node, childrenOf);
    assert.deepEqual(result, { component: "Stack", children: [{ component: "Heading" }, { component: "Stack", children: [] }] });
    assert.deepEqual(node.children[0], { component: "Heading", children: [] });
  });

  it("does not walk props", () => {
    const root = { tag: "div", children: [{ component: "Heading", children: [] }] };
    const result = omitEmptyChildren({ component: "Markup", props: { root }, children: [] }, childrenOf) as {
      props: { root: unknown };
    };
    assert.equal(result.props.root, root);
  });

  it("treats a one-element array as non-empty and returns other values as is", () => {
    const slot = { component: "Heading", children: [null] };
    assert.deepEqual(omitEmptyChildren(slot, childrenOf), slot);
    assert.equal(omitEmptyChildren(null, childrenOf), null);
    assert.equal(omitEmptyChildren("x", childrenOf), "x");
  });
});
