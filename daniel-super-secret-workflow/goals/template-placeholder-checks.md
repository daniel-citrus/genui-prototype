---
id: template-placeholder-checks
priority: 40
depends: []
touches:
  - server/customComponents/definition.ts
  - server/customComponents/definition.test.ts
  - server/customComponents/testDefinitions.ts
  - server/customComponents/expand.test.ts
  - server/agent/tools/customComponents.ts
  - server/agent/tools/customComponents.test.ts
  - docs/ARCHITECTURE.md
scope: medium
---

# Refuse {{...}} placeholders and unused declared props in define_component

## Sources

- [Eval findings fixes — R1, R2, Design, Errors and edge cases](../plans/eval-findings-fixes.md#r1-refuse--placeholders-in-templates)

## Context

In the `price-tag` eval the model saved a custom component whose Markup text
was `"{{props.price}}"` instead of `{"$prop": "price"}`. `define_component`
accepted it, so the design showed the literal `{{props.price}}`, and the
declared prop `price` was never read.

`define_component` (`server/agent/tools/customComponents.ts`) calls
`validateDefinition` in `server/customComponents/definition.ts`; nothing else
calls it, and stored components are not revalidated when they expand
(`server/customComponents/expand.ts`). `validateDefinition` runs
`checkTemplate(template, declared, children, catalog)`, which walks the
template:

- `placeholder(value, path)` checks a `{"$prop": ...}` is exactly
  `{"$prop": "<name>"}` and that the name is in `declared`
  (`propsSchema.properties`, or `{}`).
- `misplaced(value, path)` walks every non-placeholder value (node prop
  values via `fillable`, Markup `text`, attribute and style values via
  `fillable`, and other Markup keys), reporting misplaced placeholders and
  slots. Plain strings are never inspected.
- `markup(element, path)` walks a Markup `root`; a Markup `root` that is
  itself a placeholder goes through `fillable`. Props of a nested custom
  component node also go through `fillable`.

`checkTemplate`'s `problems` are pushed into `validateDefinition`'s problems,
and any of them sets `expandable = false`, which skips expanding the template
with `exampleProps`. That expansion is where catalog props problems get
their hint, such as `template.props.root is required (call get_component Markup for its props)`.
All problems are capped by `limitErrors` (`server/ui/validateTree.ts`, at most
`MAX_ERRORS`, 20).

Decision (2026-10-23, differs from the plan's Design section): the two new
problem kinds are reported but must not set `expandable = false`. They cause
no follow-on expansion errors, and blocking would hide the `get_component`
hint for a model that guessed Markup's props, as in the existing test
"points guessed Markup props at get_component".

## Scope

In `server/customComponents/definition.ts`:

- R1: in `misplaced`, check each plain string against
  `/\{\{\s*([^{}]+?)\s*\}\}/`. On a match, report
  `` `${path} "${excerpt}" looks like a {{...}} placeholder, which is shown as written; use {"$prop": "${name}"}` ``,
  where `excerpt` is the string's first 60 characters (no ellipsis) and
  `name` is the last dot-separated part of the captured text, spaces
  trimmed, when `Object.hasOwn(declared, name)`; otherwise the literal
  `<name>`. One problem per matching string. Strings inside a placeholder
  object and strings in `exampleProps` are not checked.
- R2: record each prop name used by a placeholder that passed
  `placeholder()` (exact shape, declared name). After the walk, for each key
  of `declared` not used, in key order, report
  `` `propsSchema.properties.${prop} is not used by the template; use it with {"$prop": "${prop}"} or remove it` ``.
  Uses in a nested custom node's props, Markup text, attributes, style, or a
  placeholder Markup `root` all count.
- Report R1 and R2 problems in template order with the other template-shape
  problems (R2 after the walk) and before expansion problems, but keep them
  out of whatever sets `expandable = false` (for example a separate list
  that `checkTemplate` returns).

In `server/agent/tools/customComponents.ts`: add to the tool `description`
and to the `template` property's description that every prop in
`props_schema` must be used in the template through `{"$prop": "<name>"}`,
and that text such as `{{name}}` is shown as written, never filled in.

Fix tests and fixtures the new rule breaks. Known ones:
`server/customComponents/definition.test.ts` tests that reuse
`menuItemCard`'s props with a template that drops them (for example
"stores the template without an empty children array on a leaf", the
node-count, depth and slot tests, "reports every problem together, at most
20", "points guessed Markup props at get_component"), and
`server/agent/tools/customComponents.test.ts` "saves the template without an
empty children array on a leaf and refuses a real child" (spreads
`menuItemCard` with a new template). Keep each test's intent: give the
definition matching props (for example via `withTemplate`) or update the
expected problems. The shared fixtures in
`server/customComponents/testDefinitions.ts` already use all their props;
keep them valid.

In `docs/ARCHITECTURE.md` §5, the **Custom component definitions.** bullet
lists `validateDefinition`'s rules: add both new rules in its style. Edit
only that bullet.

Out of scope: checking `{{...}}` in `render_ui` trees outside templates,
revalidating stored components, Markup docs in `server/catalog/components.ts`,
and the system prompt.

## Acceptance

- A template with Markup root `{"tag": "span", "text": "{{props.price}}"}`
  and declared prop `price` is refused with a problem at
  `template.props.root.text` containing `{"$prop": "price"}`.
- A Heading with `"text": "Hello {{name}}"` and declared prop `name` is
  refused at `template.props.text` with `{"$prop": "name"}`.
- `{{ unknown.thing }}` where `thing` is not declared shows
  `{"$prop": "<name>"}`.
- A matching string longer than 60 characters is quoted as its first 60
  characters only.
- Strings with a single `{` or `}`, or `{{` with no closing `}}`, are
  accepted.
- A definition declaring `price` and `label` that uses only
  `{"$prop": "price"}` is refused with
  `propsSchema.properties.label is not used by the template; use it with {"$prop": "label"} or remove it`.
- A prop used only in a nested custom component's props, or only in a Markup
  attribute or style value, counts as used. A definition with no
  `properties`, or `properties: {}`, gets no R2 problem.
- R1 and R2 problems appear together with the other problems, within the
  20-problem cap, and do not stop the expansion check: the "points guessed
  Markup props at get_component" case (Markup `props.markup` set to
  `"<span><strong>{{price}}</strong></span>"`, declared `price`) returns, in
  order, the R1 problem at `template.props.markup`, the R2 problem for
  `price`, `template.props.root is required (call get_component Markup for its props)`
  and `template.props.markup is not allowed`.
- Valid definitions (`menuItemCard`, `barChart`, `panel`, `specials`) save
  exactly as before.
- A stored component that declares an unused prop, saved straight to the
  repository rather than through `define_component`, still expands without
  errors.
- The `define_component` tool and `template` descriptions state both rules.

## Validation

- `npm test`: passes, including new tests (to add) in
  `server/customComponents/definition.test.ts` for every acceptance item
  above, and in `server/customComponents/expand.test.ts` for a stored
  component with an unused prop. Database and Redis tests skip without
  `DATABASE_URL` and `REDIS_URL`.
- `npm run typecheck`: passes.
- `npm run build:api`: succeeds.

## After merge

- With `OPENAI_API_KEY` set, run `npm run eval` and check in `eval-logs/<timestamp>/price-tag.json` that any `{{...}}` template was refused by `define_component` and the final design draws the price.
