---
id: markup-error-hints
priority: 50
depends: []
touches:
  - shared/markup.ts
  - server/ui/markup.test.ts
  - server/ui/validateTree.test.ts
  - server/customComponents/definition.test.ts
scope: small
---

# Name the allowed alternative when Markup refuses a tag or style property

## Sources

- [Eval findings fixes — R3, R4, Interfaces, Security](../plans/eval-findings-fixes.md#r3-name-an-allowed-tag-when-a-markup-tag-is-refused)

## Context

In an eval run the model wrote Markup tag `b`, got `tag "b" is not allowed`,
then wrote style `fontWeight`, got `style.fontWeight is not allowed`, and told
the person bold isn't supported. Both `strong` and `font-weight` are allowed;
the errors just never said so.

`sanitizeMarkup` in `shared/markup.ts` is shared by the server
(`server/ui/markup.ts` `validateMarkup`, called from
`server/ui/validateTree.ts`) and the browser sandbox (`src/sandbox/markup.ts`,
which passes no `report` callback, so it never sees messages). Today:

- In `visit`, an unknown tag (`!Object.hasOwn(tags, tag)`, where `tags` is
  `MARKUP_SVG_TAGS` inside an svg and `MARKUP_HTML_TAGS` otherwise) reports
  `` `${at}.tag "${tag}" is not allowed${where}` ``. `where` is
  ` inside an svg` for an HTML tag used inside an svg and ` outside an svg`
  for an SVG tag used outside one; otherwise it is empty.
- `styleProblem(property, value)` returns `"is not allowed"` when
  `MARKUP_STYLE_PROPERTIES` (all kebab-case, including `font-weight` and
  `background-color`) does not include `property`; the caller reports
  `` `${at}.style.${property} ${problem}` `` and drops the property.
- `MARKUP_HTML_TAGS` has 33 tags in this declared order: div, span, p,
  strong, em, small, br, hr, h1, h2, h3, h4, ul, ol, li, table, thead, tbody,
  tr, th, td, caption, label, input, select, option, button, img, figure,
  figcaption, progress, meter, svg. `MARKUP_SVG_TAGS` has g, rect, circle,
  ellipse, line, polyline, polygon, path, text, tspan, title.

## Scope

Change only message strings in `shared/markup.ts`; what `sanitizeMarkup`
keeps and drops must not change for any input.

- Add `export const MARKUP_TAG_ALTERNATIVES: Readonly<Record<string, string>> = { b: "strong", i: "em", h5: "h4", h6: "h4" };`,
  used only for an unknown tag outside an svg. Look it up with
  `Object.hasOwn`, so a tag such as `constructor` never reads a prototype
  value.
- Unknown tag, when `where` is empty:
  - outside an svg with an alternative:
    `` `${at}.tag "${tag}" is not allowed (use ${alt})` ``;
  - otherwise: `` `${at}.tag "${tag}" is not allowed (allowed: ${names.join(", ")})` ``,
    where `names` is `Object.keys` of the tag list for that context
    (`MARKUP_HTML_TAGS` outside an svg, `MARKUP_SVG_TAGS` inside one), in
    declared order.
  - The ` inside an svg` and ` outside an svg` messages keep their current
    text exactly, with no suffix.
- Add a small `kebabCase` helper (each uppercase letter becomes `-` plus its
  lowercase). In `styleProblem`, when the property is refused and
  `kebab !== property` and `MARKUP_STYLE_PROPERTIES.includes(kebab)`, return
  `` `is not allowed (use ${kebab})` ``; otherwise keep `"is not allowed"`.
- Update existing expectations that assert the old unknown-tag message:
  - `server/ui/markup.test.ts` "refuses tags outside the allowlist": the
    `script`, `style`, `iframe`, `a`, `object`, `form`, `textarea`,
    `constructor` cases get the HTML `(allowed: ...)` suffix; the
    `foreignObject`, `use`, `animate`, `image` cases inside an svg get the SVG
    list.
  - `server/ui/validateTree.test.ts`: the two `tag "script" is not allowed`
    expectations.
  - `server/customComponents/definition.test.ts`: the
    `template.children.3.props.root.children.0.tag "script" is not allowed`
    expectation in "refuses catalog prop and Markup problems in the expanded
    example". Edit only that line; another goal changes other tests in this
    file.

Out of scope: listing the allowlist in `get_component Markup`
(`server/catalog/components.ts`), and any change to what is allowed.

## Acceptance

- `{"tag": "b"}` outside an svg reports `` `<path>.tag "b" is not allowed (use strong)` ``;
  `i` reports `(use em)`; `h5` and `h6` report `(use h4)`.
- `{"tag": "marquee"}` outside an svg reports
  `is not allowed (allowed: div, span, p, strong, ... , meter, svg)` with all
  33 `MARKUP_HTML_TAGS` names in declared order, joined with `, `.
- An unknown tag inside an svg (such as `foreignObject`, or `b`) lists the
  `MARKUP_SVG_TAGS` names: `(allowed: g, rect, circle, ellipse, line, polyline, polygon, path, text, tspan, title)`.
- `constructor` outside an svg gets the HTML allowed list, not a prototype
  value.
- `rect` outside an svg still reports `is not allowed outside an svg`, and
  `div` inside an svg still reports `is not allowed inside an svg`, unchanged.
- `style: {"fontWeight": "bold"}` reports `` `<path>.style.fontWeight is not allowed (use font-weight)` ``;
  `backgroundColor` reports `(use background-color)`.
- `position` and `zIndex` keep the plain `is not allowed` message.
- For every refused input above, `sanitizeMarkup`'s returned element is the
  same as before: the refused tag, element or style is still dropped.

## Validation

- `npm test`: passes, including new tests in `server/ui/markup.test.ts` (to
  add) for `b`, `i`, `h5`, `h6`, `marquee`, an unknown tag inside an svg,
  `constructor`, `fontWeight`, `backgroundColor`, `position`, `zIndex`, and
  assertions that the sanitized output for those inputs drops the same
  things (call `sanitizeMarkup` from `shared/markup` directly and compare
  its returned element to the expected one; `validateMarkup` returns only
  messages).
- `npm run typecheck`: passes.
- `npm run build` and `npm run build:api`: both succeed (the browser bundle
  imports `shared/markup.ts`).
