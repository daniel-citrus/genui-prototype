import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tidyDesign } from "./tidyDesign";

const markup = (root: unknown) => ({ component: "Markup", props: { root } });

describe("tidyDesign", () => {
  it("drops null children at any depth without mutating the input", () => {
    const tree = {
      component: "Stack",
      children: [{ component: "Card", children: [{ component: "Divider" }, null] }, null],
    };
    assert.deepEqual(tidyDesign(tree), {
      component: "Stack",
      children: [{ component: "Card", children: [{ component: "Divider" }] }],
    });
    assert.equal(tree.children.length, 2);
    assert.equal(tree.children[0]!.children.length, 2);
  });

  it("keeps other malformed children for the checks to report", () => {
    const tree = { component: "Stack", children: ["text", 3, undefined, {}] };
    assert.deepEqual(tidyDesign(tree), tree);
  });

  it("swaps b, i, h5 and h6 for their allowed tags in Markup, and drops null elements", () => {
    const root = {
      tag: "div",
      children: [
        { tag: "b", text: "Bold" },
        { tag: "i", text: "Slanted" },
        null,
        { tag: "h5", children: [{ tag: "h6", text: "Deep" }] },
      ],
    };
    assert.deepEqual(tidyDesign(markup(root)), markup({
      tag: "div",
      children: [
        { tag: "strong", text: "Bold" },
        { tag: "em", text: "Slanted" },
        { tag: "h4", children: [{ tag: "h4", text: "Deep" }] },
      ],
    }));
    assert.equal(root.children[0]!.tag, "b");
  });

  it("leaves tags inside an svg and props of other components alone", () => {
    const svg = markup({ tag: "svg", children: [{ tag: "b" }] });
    assert.deepEqual(tidyDesign(svg), svg);
    const text = { component: "Text", props: { root: { tag: "b" } } };
    assert.deepEqual(tidyDesign(text), text);
  });

  it("returns a non-object as is", () => {
    assert.equal(tidyDesign(null), null);
    assert.equal(tidyDesign("x"), "x");
  });
});
