import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterMarkup } from "./markup";

const chart = {
  tag: "div",
  style: { display: "flex", gap: "8px", "align-items": "flex-end" },
  children: [
    {
      tag: "svg",
      attrs: { viewBox: "0 0 100 40", width: 200, "aria-label": "Sales" },
      children: [
        { tag: "title", text: "Sales" },
        { tag: "rect", attrs: { x: 0, y: 10, width: 20, height: 30, fill: "#0ea5e9" } },
        { tag: "text", attrs: { x: 10, y: 8, "text-anchor": "middle" }, text: "Jan" },
      ],
    },
    {
      tag: "label",
      text: "Agree",
      children: [{ tag: "input", attrs: { name: "agree", type: "checkbox", checked: true } }],
    },
    {
      tag: "select",
      attrs: { name: "size" },
      children: [{ tag: "option", attrs: { value: "s", selected: true }, text: "Small" }],
    },
    { tag: "img", attrs: { src: "https://example.com/a.png", alt: "A" } },
    { tag: "button", action: "place_order", attrs: { disabled: false }, text: "Order" },
  ],
};

describe("filterMarkup", () => {
  it("keeps allowed elements unchanged", () => {
    assert.deepEqual(filterMarkup(chart), chart);
  });

  it("drops script elements, event handlers, url() styles, javascript: images and password inputs", () => {
    const root = {
      tag: "div",
      attrs: { title: "Card", onclick: "alert(1)" },
      style: { color: "red", background: "url(https://example.com/x.png)", "background-color": "url(x)" },
      children: [
        { tag: "script", text: "alert(1)" },
        { tag: "img", attrs: { src: "javascript:alert(1)", alt: "x" } },
        { tag: "input", attrs: { name: "secret", type: "password" } },
        { tag: "p", text: "Kept" },
      ],
    };
    assert.deepEqual(filterMarkup(root), {
      tag: "div",
      attrs: { title: "Card" },
      style: { color: "red" },
      children: [
        { tag: "img", attrs: { alt: "x" } },
        { tag: "p", text: "Kept" },
      ],
    });
  });

  it("drops what the server refuses: misplaced tags, actions and text, placeholders, unknown keys", () => {
    const root = {
      tag: "div",
      action: "save",
      innerHTML: "<b>x</b>",
      children: [
        { tag: "svg", children: [{ tag: "div" }, { tag: "foreignObject" }, { tag: "circle", attrs: { r: 4 } }] },
        { tag: "rect" },
        { tag: "button", action: "Bad-Name", text: { $prop: "label" }, style: { position: "fixed" } },
        { tag: "br", text: "x" },
      ],
    };
    assert.deepEqual(filterMarkup(root), {
      tag: "div",
      children: [
        { tag: "svg", children: [{ tag: "circle", attrs: { r: 4 } }] },
        { tag: "button", style: {} },
        { tag: "br" },
      ],
    });
  });

  it("returns null for a root that isn't an allowed element, and cuts the tree at the limits", () => {
    assert.equal(filterMarkup({ tag: "script" }), null);
    assert.equal(filterMarkup("<p>x</p>"), null);

    const wide = filterMarkup({ tag: "div", children: Array.from({ length: 250 }, () => ({ tag: "span" })) });
    assert.equal(wide?.children?.length, 199);

    let deep: unknown = { tag: "span" };
    for (let i = 0; i < 14; i++) deep = { tag: "div", children: [deep] };
    let level = 0;
    for (let node = filterMarkup(deep) ?? undefined; node; node = node.children?.[0]) level += 1;
    assert.equal(level, 12);
  });
});
