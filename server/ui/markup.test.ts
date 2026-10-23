import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSafeImageSrc,
  MARKUP_HTML_TAGS,
  MARKUP_SVG_TAGS,
  markupValueProblem,
  sanitizeMarkup,
} from "shared/markup";
import { validateMarkup } from "./markup";

const at = "tree.children.0.props.root";
const check = (root: unknown) => validateMarkup(root, at);
const div = (...children: unknown[]) => ({ tag: "div", children });
const svg = (...children: unknown[]) => ({ tag: "svg", attrs: { viewBox: "0 0 100 40" }, children });
const htmlAllowed = ` (allowed: ${Object.keys(MARKUP_HTML_TAGS).join(", ")})`;
const svgAllowed = ` (allowed: ${Object.keys(MARKUP_SVG_TAGS).join(", ")})`;
const useAllowed = "(use rgb, rgba, hsl, hsla, calc, min, max, clamp, repeat, minmax, fit-content)";

const barChart = {
  tag: "figure",
  style: { margin: "0", display: "flex", "flex-direction": "column", gap: "4px" },
  children: [
    {
      tag: "svg",
      attrs: { viewBox: "0 0 100 40", width: 300, height: 120, "aria-label": "Sales by month" },
      children: [
        { tag: "title", text: "Sales by month" },
        {
          tag: "g",
          attrs: { fill: "#0ea5e9", transform: "translate(0 2)" },
          children: [
            { tag: "rect", attrs: { x: 0, y: 10, width: 20, height: 28, rx: 2 } },
            { tag: "rect", attrs: { x: 30, y: 4, width: 20, height: 34, rx: 2 } },
            { tag: "line", attrs: { x1: 0, y1: 38, x2: 100, y2: 38, stroke: "#71717a", "stroke-width": 0.5 } },
          ],
        },
        { tag: "text", attrs: { x: 10, y: 8, "text-anchor": "middle", "font-size": 4 }, text: "Jan" },
      ],
    },
    { tag: "figcaption", style: { color: "#71717a", "font-size": "12px" }, text: "Sales, first quarter" },
  ],
};

const orderForm = {
  tag: "div",
  style: { display: "grid", gap: "8px", "max-width": "320px" },
  children: [
    {
      tag: "label",
      text: "Name",
      children: [{ tag: "input", attrs: { name: "name", type: "text", placeholder: "Your name", maxlength: 80 } }],
    },
    {
      tag: "select",
      attrs: { name: "size" },
      children: [
        { tag: "option", attrs: { value: "small" }, text: "Small" },
        { tag: "option", text: "Large" },
      ],
    },
    { tag: "input", attrs: { name: "gift", type: "checkbox", checked: false } },
    {
      tag: "button",
      action: "place_order",
      style: { padding: "6px 12px", "border-radius": "6px", "background-color": "#18181b", color: "white" },
      text: "Order",
    },
  ],
};

describe("validateMarkup", () => {
  it("accepts an SVG bar chart and a form with an input, a select and an action button", () => {
    assert.deepEqual(check(barChart), []);
    assert.deepEqual(check(orderForm), []);
  });

  it("refuses unknown keys and elements that aren't objects with a tag", () => {
    assert.deepEqual(check(div({ tag: "span", onclick: "alert(1)", html: "<b>x</b>" }, "text", { text: "x" })), [
      `${at}.children.0.onclick is not allowed (use tag, attrs, style, text, action, children)`,
      `${at}.children.0.html is not allowed (use tag, attrs, style, text, action, children)`,
      `${at}.children.1 must be an object with a "tag" string`,
      `${at}.children.2 must be an object with a "tag" string`,
    ]);
    assert.deepEqual(check("<div></div>"), [`${at} must be an object with a "tag" string`]);
  });

  it("refuses tags outside the allowlist", () => {
    const tags = ["script", "style", "iframe", "a", "object", "form", "textarea", "constructor"];
    assert.deepEqual(
      check(div(...tags.map((tag) => ({ tag })))),
      tags.map((tag, i) => `${at}.children.${i}.tag "${tag}" is not allowed${htmlAllowed}`),
    );
    assert.deepEqual(check(svg({ tag: "foreignObject" }, { tag: "use" }, { tag: "animate" }, { tag: "image" })), [
      `${at}.children.0.tag "foreignObject" is not allowed${svgAllowed}`,
      `${at}.children.1.tag "use" is not allowed${svgAllowed}`,
      `${at}.children.2.tag "animate" is not allowed${svgAllowed}`,
      `${at}.children.3.tag "image" is not allowed${svgAllowed}`,
    ]);
  });

  it("names the allowed tag for a refused common tag, and lists the allowlist otherwise", () => {
    const alternatives = { b: "strong", i: "em", h5: "h4", h6: "h4" };
    const tags = Object.keys(alternatives);
    assert.deepEqual(
      check(div(...tags.map((tag) => ({ tag })))),
      Object.entries(alternatives).map(([tag, alt], i) => `${at}.children.${i}.tag "${tag}" is not allowed (use ${alt})`),
    );
    assert.deepEqual(check({ tag: "marquee" }), [`${at}.tag "marquee" is not allowed${htmlAllowed}`]);
    assert.equal(htmlAllowed.split(", ").length, 33);
    assert.deepEqual(check(svg({ tag: "b" })), [`${at}.children.0.tag "b" is not allowed${svgAllowed}`]);
    assert.deepEqual(check({ tag: "constructor" }), [`${at}.tag "constructor" is not allowed${htmlAllowed}`]);
    assert.equal(sanitizeMarkup(div({ tag: "b" }, { tag: "span", text: "x" }), at)?.children?.length, 1);
  });

  it("refuses SVG tags outside an svg and HTML tags inside one", () => {
    assert.deepEqual(check({ tag: "rect" }), [`${at}.tag "rect" is not allowed outside an svg`]);
    assert.deepEqual(check(div({ tag: "circle" })), [`${at}.children.0.tag "circle" is not allowed outside an svg`]);
    assert.deepEqual(check(svg({ tag: "g", children: [{ tag: "div" }, { tag: "svg" }] })), [
      `${at}.children.0.children.0.tag "div" is not allowed inside an svg`,
      `${at}.children.0.children.1.tag "svg" is not allowed inside an svg`,
    ]);
  });

  it("refuses attributes not allowed on the tag", () => {
    const attrs = { onclick: "x", onmouseover: "x", href: "x", id: "x", class: "x", style: "x", "xlink:href": "x" };
    assert.deepEqual(
      check({ tag: "div", attrs }),
      Object.keys(attrs).map((name) => `${at}.attrs.${name} is not allowed`),
    );
    assert.deepEqual(check({ tag: "span", attrs: { src: "https://example.com/a.png", colspan: 2 } }), [
      `${at}.attrs.src is not allowed`,
      `${at}.attrs.colspan is not allowed`,
    ]);
    assert.deepEqual(check(svg({ tag: "rect", attrs: { r: 3, "aria-label": "x" } })), [
      `${at}.children.0.attrs.r is not allowed`,
      `${at}.children.0.attrs.aria-label is not allowed`,
    ]);
  });

  it("refuses attribute values of the wrong kind", () => {
    assert.deepEqual(
      check({ tag: "input", attrs: { disabled: "disabled", checked: 1, name: true, title: ["x"] } }),
      [
        `${at}.attrs.disabled must be true or false`,
        `${at}.attrs.checked must be true or false`,
        `${at}.attrs.name must be a string or number`,
        `${at}.attrs.title must be a string or number`,
      ],
    );
  });

  it("refuses style properties outside the allowlist", () => {
    const style = { position: "fixed", "z-index": "10", transform: "scale(2)", background: "red", top: "0" };
    assert.deepEqual(
      check({ tag: "div", style }),
      Object.keys(style).map((property) => `${at}.style.${property} is not allowed`),
    );
  });

  it("names the kebab-case property for a refused camelCase style property", () => {
    const style = { fontWeight: "bold", backgroundColor: "red", position: "fixed", zIndex: "10", color: "red" };
    assert.deepEqual(check({ tag: "div", style }), [
      `${at}.style.fontWeight is not allowed (use font-weight)`,
      `${at}.style.backgroundColor is not allowed (use background-color)`,
      `${at}.style.position is not allowed`,
      `${at}.style.zIndex is not allowed`,
    ]);
    assert.deepEqual(sanitizeMarkup({ tag: "div", style }, at)?.style, { color: "red" });
  });

  it("refuses unsafe attribute and style values", () => {
    assert.deepEqual(
      check({
        tag: "div",
        attrs: { title: "<b>", "aria-label": "a".repeat(201) },
        style: {
          "background-color": "URL(https://example.com/x.png)",
          width: "expression(alert(1))",
          color: "\\72 ed",
          "font-family": "@import",
          display: "contents",
          opacity: 1,
        },
      }),
      [
        `${at}.attrs.title must not contain "<"`,
        `${at}.attrs.aria-label is longer than 200 characters`,
        `${at}.style.background-color must not contain "url("`,
        `${at}.style.width must not contain "expression"`,
        `${at}.style.color must not contain "\\\\"`,
        `${at}.style.font-family must not contain "@"`,
        `${at}.style.display must be one of block, inline, inline-block, flex, grid, none`,
        `${at}.style.opacity must be a string`,
      ],
    );
  });

  it("refuses image sources that aren't http or https URLs", () => {
    for (const src of ["data:image/png;base64,AAAA", "//example.com/a.png", "/a.png", "ftp://example.com/a.png"]) {
      assert.deepEqual(check({ tag: "img", attrs: { src } }), [`${at}.attrs.src must be an http: or https: URL`]);
    }
    assert.deepEqual(check({ tag: "img", attrs: { src: "javascript:alert(1)" } }), [
      `${at}.attrs.src must not contain "javascript:"`,
    ]);
    assert.deepEqual(check({ tag: "img", attrs: { src: "https://example.com/a.png", alt: "A" } }), []);
  });

  it("refuses input types outside the list and a maxlength above 1000", () => {
    for (const type of ["password", "radio", "file", "hidden", "submit"]) {
      assert.deepEqual(check({ tag: "input", attrs: { type } }), [
        `${at}.attrs.type must be one of text, email, number, date, time, url, tel, checkbox, range`,
      ]);
    }
    assert.deepEqual(check({ tag: "input", attrs: { maxlength: 1001 } }), [
      `${at}.attrs.maxlength must be a whole number from 0 to 1000`,
    ]);
    assert.deepEqual(check({ tag: "input", attrs: { maxlength: "1000", type: "range", min: 0, max: 5 } }), []);
  });

  it("allows an action only on a button, and only a snake_case one", () => {
    assert.deepEqual(check(div({ tag: "div", action: "save" }, { tag: "button", action: "Save-Order" })), [
      `${at}.children.0.action is only allowed on a button`,
      `${at}.children.1.action must be a snake_case action name`,
    ]);
  });

  it("refuses long text and text on elements that take none", () => {
    const tags = ["input", "select", "img", "br", "hr"];
    assert.deepEqual(
      check(div(...tags.map((tag) => ({ tag, text: "x" })), { tag: "p", text: "x".repeat(1001) })),
      [
        ...tags.map((tag, i) => `${at}.children.${i}.text is not allowed on ${tag}`),
        `${at}.children.5.text is longer than 1000 characters`,
      ],
    );
    assert.deepEqual(check({ tag: "p", text: 7 }), [`${at}.text must be a string`]);
  });

  it("refuses placeholders left unfilled", () => {
    const unfilled = { $prop: "label" };
    assert.deepEqual(
      check({ tag: "button", attrs: { title: unfilled }, style: { color: unfilled }, text: unfilled, action: unfilled }),
      ["attrs.title", "style.color", "text", "action"].map(
        (key) => `${at}.${key} is a {"$prop"} placeholder that was not filled`,
      ),
    );
  });

  it("refuses more than 200 elements or 12 levels", () => {
    const wide = div(...Array.from({ length: 200 }, () => ({ tag: "span" })));
    assert.deepEqual(check(wide), [`${at} has more than 200 elements`]);
    assert.deepEqual(check(div(...Array.from({ length: 199 }, () => ({ tag: "span" })))), []);

    const nest = (levels: number): unknown => (levels === 1 ? { tag: "span" } : div(nest(levels - 1)));
    assert.deepEqual(check(nest(12)), []);
    assert.deepEqual(check(nest(13)), [`${at} is more than 12 levels deep`]);
  });

  it("refuses attrs, style and children of the wrong shape", () => {
    assert.deepEqual(check({ tag: "div", attrs: [], style: "color: red", children: {} }), [
      `${at}.attrs must be an object`,
      `${at}.style must be an object`,
      `${at}.children must be an array`,
    ]);
  });

  /** Styles that could hide a field, one per line. */
  const hiding: [string, string][] = [
    ["display", "none"],
    ["opacity", "0"],
    ["opacity", "0.49"],
    ["opacity", "40%"],
    ["opacity", "calc(1)"],
    ["width", "0"],
    ["width", "-1px"],
    ["height", "0px"],
    ["max-width", "0%"],
    ["max-height", "0em"],
    ["max-height", "min(0px, 10px)"],
    ["font-size", "0"],
    ["margin", "0 0 -1px"],
    ["margin-top", "-5px"],
    ["margin-right", "-1em"],
    ["margin-bottom", "calc(0px - 10px)"],
    ["margin-left", "-100%"],
  ];

  it("refuses styles that could hide a control or an element holding one", () => {
    const controls = [
      { tag: "input", attrs: { name: "price", value: "1" } },
      { tag: "select", attrs: { name: "size" }, children: [{ tag: "option", text: "Small" }] },
      { tag: "button", action: "save", text: "Save" },
    ];
    for (const [property, value] of hiding) {
      const style = { [property]: value };
      const hides = (path: string) => [`${at}${path}.style.${property} hides a field that sends a value`];
      for (const control of controls) {
        assert.deepEqual(check(div({ ...control, style })), hides(".children.0"), `${control.tag} ${property}`);
      }
      assert.deepEqual(
        check({ tag: "div", style, children: [{ tag: "p" }, { tag: "label", children: [controls[0]] }] }),
        hides(""),
        `ancestor ${property}`,
      );
    }
  });

  it("accepts those styles on elements with no control inside, and other sizes on controls", () => {
    for (const [property, value] of hiding) {
      const style = { [property]: value };
      const decorations = [
        { tag: "span", style, text: "Note" },
        svg({ tag: "rect", attrs: { width: 0 } }),
        { tag: "input", attrs: { type: "text" }, style },
        { tag: "button", style, text: "Close" },
      ];
      assert.deepEqual(check(div(...decorations, orderForm)), [], property);
    }
    const style = {
      display: "block",
      opacity: "0.5",
      width: "calc(100% - 16px)",
      "max-width": "none",
      "font-size": "0.9rem",
      margin: "0 auto",
    };
    assert.deepEqual(check({ tag: "div", style, children: [{ tag: "input", attrs: { name: "price" }, style }] }), []);
    assert.deepEqual(check({ tag: "div", style: { opacity: "50%" }, children: [orderForm] }), []);
  });

  it("refuses function calls other than the allowed ones, and SVG transforms outside transform", () => {
    assert.deepEqual(
      check(
        svg({
          tag: "g",
          attrs: { transform: "rotate(45) translate(1 2) SkewX(3)", fill: "scale(2)" },
          style: { fill: "var(--x)" },
        }),
      ),
      [
        `${at}.children.0.attrs.fill must not call "scale(" ${useAllowed}`,
        `${at}.children.0.style.fill must not call "var(" ${useAllowed}`,
      ],
    );
  });
});

describe("markupValueProblem", () => {
  it("accepts ordinary values and refuses unsafe parts in any case", () => {
    for (const value of ["#0ea5e9", "1px solid rgb(0 0 0 / 0.5)", "repeat(3, 1fr)", "M0 0 L10 10 Z"]) {
      assert.equal(markupValueProblem(value), undefined, value);
    }
    for (const value of ["Url(x)", "EXPRESSION(x)", "JavaScript:void(0)", "a@b", "a\\b", "<", ">"]) {
      assert.notEqual(markupValueProblem(value), undefined, value);
    }
  });

  it("refuses function calls other than the allowed ones in any case, keeping the url( message", () => {
    const refused = {
      'src("a.png")': "src(",
      "IMAGE-SET(a.png 1x)": "image-set(",
      "-webkit-image-set(a.png 1x)": "-webkit-image-set(",
      "Image(red)": "image(",
      "element(#a)": "element(",
      "cross-fade(red, blue)": "cross-fade(",
      "VAR(--x)": "var(",
      "attr(title)": "attr(",
      "calc(1px + var(--x))": "var(",
    };
    for (const [value, call] of Object.entries(refused)) {
      assert.equal(markupValueProblem(value), `must not call ${JSON.stringify(call)} ${useAllowed}`, value);
    }
    assert.equal(markupValueProblem("URL(a.png)"), 'must not contain "url("');

    const accepted = [
      "rgb(0 0 0)",
      "RGBA(0, 0, 0, .5)",
      "hsl(200 50% 40%)",
      "hsla(200, 50%, 40%, 0.5)",
      "calc(100% - 8px)",
      "min(10px, 5vw)",
      "max(10px, 5vw)",
      "clamp(1rem, 2vw, 2rem)",
      "repeat(3, minmax(0, 1fr))",
      "fit-content(200px)",
      "#1f2937",
      "12px",
      "1fr 2fr",
      "Sales (first quarter)",
    ];
    for (const value of accepted) assert.equal(markupValueProblem(value), undefined, value);
  });
});

describe("isSafeImageSrc", () => {
  it("accepts only absolute http and https URLs", () => {
    assert.equal(isSafeImageSrc("https://example.com/a.png"), true);
    assert.equal(isSafeImageSrc("http://example.com/a.png"), true);
    for (const src of ["https:example.com", "ftp://example.com/a.png", "javascript:x", "a.png", "https://"]) {
      assert.equal(isSafeImageSrc(src), false, src);
    }
  });
});
