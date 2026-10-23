---
id: template-each
priority: 20
depends: []
touches:
  - shared/customComponents.ts
  - shared/markup.ts
  - server/customComponents/definition.ts
  - server/customComponents/definition.test.ts
  - server/customComponents/expand.ts
  - server/customComponents/expand.test.ts
  - server/agent/tools/ui.test.ts
  - server/agent/tools/customComponents.ts
  - docs/ARCHITECTURE.md
scope: medium
---

# Repeat a template part once per item of a list prop

## Sources

- [Component generation plan — R1 Repetition in templates](../plans/data-driven-components-and-card-forms.md#r1-repetition-in-templates)
- [Component generation plan — R2 Errors that point at repetition](../plans/data-driven-components-and-card-forms.md#r2-errors-that-point-at-repetition)
- [Component generation plan — Design](../plans/data-driven-components-and-card-forms.md#design)

## Context

A saved custom component can't repeat anything over a list it is given, so a
list, chart or table built from data can't be saved. In a real trace the agent
tried three times to save an `ItemBulletList` and failed each time:
`text: {"$prop": "items"}` ("must be a string"), a made-up `"{$each:items}"`
string ("items is not used by the template"), and `children: {"$prop": "items"}`
("only allowed as a whole prop value…").

Current code:

- `shared/customComponents.ts` defines `TemplateNode` (its `children` may hold
  `{ $children: true }`) and the limits `MAX_DEFINITION_CHARS` 8000,
  `MAX_TEMPLATE_NODES` 40 and `MAX_EXPANDED_NODES` 400.
- `server/customComponents/definition.ts` `checkTemplate` allows `{"$prop"}`
  only as a whole prop value or as a Markup `text`, attribute or style value
  (branches `placeholder`, `misplaced`, `markup`, `node`), and requires every
  declared prop to be used. `validateDefinition` expands the template with
  `exampleProps` and validates the result.
- `server/customComponents/expand.ts`: `fillTemplate`, `fillMarkup` and
  `fillValues` substitute placeholders (an undefined fill leaves the key out),
  and `expandTree` replaces custom nodes. Instance props are checked against
  `props_schema` first (`expandCustom`), so a non-array value can't reach
  expansion. `omitEmptyChildren` already handles an empty children array.
- `shared/markup.ts` holds the Markup allowlist and `sanitizeMarkup`; each
  Markup root is capped at 200 elements and 12 levels.
- `server/agent/tools/customComponents.ts` holds the `define_component` tool,
  whose `template` description documents the template syntax.

This goal is the first of the plan's slices and has no prerequisites. The
`markup-rules-discovery`, `build-recovery` and `agent-guidance` goals build on
it. `card-scoped-checks` adds a separate `describe` block to
`server/customComponents/definition.test.ts`, and `markup-in-designs` adds
separate `it` blocks to `server/agent/tools/ui.test.ts`; keep your additions in
their own blocks.

## Scope

Add one level of repetition to templates. The syntax is an entry
`{"$each": "<prop>", "as": <node or element>}` placed in a template node's
`children` array or in a Markup element's `children` array. Inside `as`,
`{"$item": true}` stands for the current item and `{"$item": "<field>"}` for
one field of it, wherever `{"$prop"}` is allowed.

Interfaces to add (additive):

```ts
// shared/customComponents.ts
/** In a template or Markup children array: one copy of `as` per item of array prop `$each`. */
export interface EachEntry<T> { $each: string; as: T; }
/** Inside an EachEntry's `as`: true is the item itself, a string is one field of it. */
export interface ItemPlaceholder { $item: true | string; }
export const MAX_EACH_ITEMS = 100;
// TemplateNode.children becomes (TemplateNode | { $children: true } | EachEntry<TemplateNode>)[]

// shared/markup.ts
export function isItemPlaceholder(value: unknown): value is Record<string, unknown>; // has "$item"
export function isEachEntry(value: unknown): value is Record<string, unknown>; // has "$each"
```

Design:

- `checkTemplate` gains an `each` branch for `$each` entries in node and Markup
  children, plus an "inside `as`" flag that makes `$item` legal there. The
  repetition hints below go in the `placeholder` and `misplaced` branches.
- Expansion threads an optional current item through `fillTemplate`,
  `fillMarkup` and `fillValues`. A `$each` entry becomes zero or more filled
  copies of `as`, spliced into the children array in order, before slots and
  child expansion.
- Update `define_component`'s `template` description to document `$each`,
  `as` and `$item` with one short example. Leave its other descriptions and
  the `writes` flag (added by `retry-after-fix`) alone.
- Update the custom-components section of `docs/ARCHITECTURE.md`.

Out of scope: arithmetic or expressions in templates, an item index, `$each`
inside `$each`, and `$each` in the agent's own `render_ui` tree (there the
agent writes the items out). No storage change: definitions are JSON, so a
saved version may now contain `$each` entries. After a rollback such a
component fails expansion with a path rather than drawing wrongly.

## Acceptance

- A `BulletList` with `items: {type: "array", items: {type: "string"}}` and
  Markup `{"tag": "ul", "children": [{"$each": "items", "as": {"tag": "li", "text": {"$item": true}}}]}`
  saves. Rendering it with `items: ["A", "B", "C"]` shows three `li` elements
  with those texts, in order.
- A component-level `$each` expands to one node per item: a Stack whose
  children are `{"$each": "rows", "as": {"component": "Text", "props": {"text": {"$item": "label"}}}}`
  gives one Text per row. A row without `label` leaves `text` out, which the
  catalog check then reports.
- `define_component` refuses, with a path, and saves nothing, when:
  - `$each` names an undeclared prop, or one whose schema `type` isn't `"array"`;
  - the entry has keys other than `$each` and `as`;
  - `as` holds another `$each` (no nesting) or a `{"$children": true}` slot;
  - `$item` appears outside an `as`;
  - `{"$item": "<field>"}` names a field the items schema doesn't declare
    (when it declares `properties`), or names any field when the items aren't
    objects;
  - `exampleProps` gives that prop no items ("so the repeated part can be checked").
- A prop used only through `$each` counts as used.
- Expanding an instance whose array has more than `MAX_EACH_ITEMS` (100) items
  reports `<path>.props.<prop> has <n> items; $each repeats at most 100` and
  draws nothing. The 400 expanded-node limit and the per-root Markup limits
  (200 elements, 12 levels) still apply after repetition.
- A missing optional array prop (no default) repeats zero times.
- The existing tree checks refuse `$each` in the agent's own `render_ui` tree.
- The Components panel preview (`server/routes/customComponents.ts`) shows
  repeated templates with no change to that route.
- Repetition hints (R2):
  - `{"$prop": "<p>"}` as a Markup `text`, attribute or style value, where
    `<p>` is declared `type: "array"`, adds the problem
    `… <p> is a list; to repeat over it use {"$each": "<p>", "as": …} in a children array`.
  - `children: {"$prop": "<p>"}` (on a node or a Markup element), where `<p>`
    is an array prop, gets the same hint after the existing "only allowed as a
    whole prop value…" message.
  - A `"{$each:…}"` or `"{{…}}"` string still gets the existing advisory problem.
- Existing saved components without `$each` expand exactly as before.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, with these new tests (database and Redis tests skip
  without `DATABASE_URL`, `TRACE_DATABASE_URL` and `REDIS_URL`):
  - `server/customComponents/definition.test.ts`: a valid string-list and
    object-list `$each`, for both Markup and component children; each refusal
    listed above; a prop used only through `$each` counts as used; the three
    bullet-list attempts from the trace each get the stated message.
  - `server/customComponents/expand.test.ts`: three items become three
    elements in order; a missing field leaves the key out; zero items; 101
    items are refused with the path; the existing caps apply after repetition.
  - `server/agent/tools/ui.test.ts`: rendering a saved `BulletList` shows its
    `li` texts, and `$each` in the agent's own tree is refused.
- `npm run build` and `npm run build:api` succeed.
