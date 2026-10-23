---
id: card-scoped-checks
priority: 20
depends: []
touches:
  - shared/formScope.ts
  - server/ui/formScope.test.ts
  - server/ui/bindings.ts
  - server/ui/bindings.test.ts
  - server/ui/validateTree.ts
  - server/ui/validateTree.test.ts
  - server/ui/checkAction.ts
  - server/ui/checkAction.test.ts
  - server/routes/actions.test.ts
  - server/customComponents/definition.test.ts
  - docs/ARCHITECTURE.md
scope: medium
---

# Scope form checks and action requests to the nearest Card

## Sources

- [Component generation plan — R4 Card-scoped bindings](../plans/data-driven-components-and-card-forms.md#r4-card-scoped-bindings-in-render_ui-and-define_component)
- [Component generation plan — R5 Card-scoped action requests](../plans/data-driven-components-and-card-forms.md#r5-card-scoped-action-requests)
- [Component generation plan — Interfaces](../plans/data-driven-components-and-card-forms.md#interfaces)
- [Component generation plan — Security](../plans/data-driven-components-and-card-forms.md#security)

## Context

A button sends every input in the whole design, and input names must be
unique across the design, so two edit forms can't sit side by side. In a
real trace, "create list of all items, and make them editable" failed with
20 "is already used by" errors once every per-item form named its fields
`item`, `name` and `description`.

Current code:

- `server/ui/bindings.ts` `collectBindings(tree)` returns `inputs`
  (`NamedInput`: TextInput, Checkbox, Select, and Markup `input`/`select`)
  and `buttons` (`ActionButton`: a Button or a Markup `button` with an
  `action`), each with its tree path in `validateUiTree` form
  (`"tree.children.0"`; Markup elements under `.props.root…`).
- `server/ui/validateTree.ts` `bindingProblems` refuses any two inputs with
  the same name (`<path>.props.name "<name>" is already used by <path>`). It
  checks each action's required properties
  (`<path> action "<a>" needs an input named "<key>", and none has that name`)
  and that an edit form has something to change
  (`… changes nothing without an input for one of: …`), once per action,
  against the whole design.
- `server/ui/checkAction.ts` `checkActionRequest(tree, action, values)` is
  called from `server/routes/actions.ts` with the remembered expanded tree
  (`getDesign`, `server/agent/conversations.ts`). It accepts a value when it
  fits any input of that name anywhere in the design, and otherwise answers
  `This design has no input named "<name>".`
- The menu action `menu_update_item` (`server/actions/menu/index.ts`)
  requires `item` (a `menu_items` choice) and edits `name`, `description` and
  `category`.
- `npm test` runs only `server/**/*.test.ts` and `src/**/*.test.ts`, so tests
  for code under `shared/` live under `server/`.

No prerequisites. The later `card-scoped-clicks` goal makes the sandbox use
the helper added here. Until it merges, a click on a per-item design is
refused with the new 400 because the old browser sends every field; that is
safe and only visible on the feature branch. `template-each` adds a separate
`describe` block to `server/customComponents/definition.test.ts`; keep yours
separate.

## Scope

Add `shared/formScope.ts`, the one function that decides form scope for the
validator, the action route and (later) the sandbox:

```ts
/**
 * Path of the nearest Card containing the node or Markup element at `path`
 * ("tree.children.0.props.root.children.1"), or undefined when none does.
 */
export function nearestCard(tree: unknown, path: string): string | undefined;
/** Whether the input at `inputPath` is sent by the action button at `buttonPath`. */
export function sendsInput(tree: unknown, buttonPath: string, inputPath: string): boolean;
```

A button's scope is everything inside its nearest enclosing Card, including
Cards nested inside it, or the whole design when it has no Card.

- `collectBindings` fills a new optional `card?: string` on `NamedInput` and
  `ActionButton` using `nearestCard`.
- `bindingProblems` checks per scope, as listed under Acceptance.
- `checkActionRequest` keeps its signature. It tries each enabled button for
  `action` in document order and accepts the first scope where every value
  fits; otherwise it returns the first scope's refusal. `ActionRunRequest`
  (`shared/api.ts`) doesn't change: the server finds the scope from the values.
- Type and dropdown checks on inputs (a Checkbox for booleans, a Select with
  source values for choice inputs, password fields) stay design-wide.
- Update the bindings and action-check sections of `docs/ARCHITECTURE.md`.

## Acceptance

`render_ui` / validation (R4):

- A design with three Cards, each holding a Select `item`, a TextInput `name`
  and a Button `menu_update_item`, renders.
- Two inputs with the same name are refused when they have the same nearest
  Card (or neither has one), with the existing
  `… "<name>" is already used by <path>`.
- Two inputs with the same name in different Cards are refused when one
  action button's scope holds both:
  `<path>.props.name "<name>" is also at <other path>, and the button at <button path> would send both; put each form in its own Card`
  (for example, an outer-Card button that sees two inner Cards).
- Each required property of an enabled action button must be named by an
  input in that button's scope:
  `<button path> action "<a>" needs an input named "<key>" in its Card, and none has that name`.
  With no Card, the existing message applies.
- The `edit` check ("changes nothing without an input for one of: …") runs
  for each enabled action button, against its scope.
- Type and dropdown checks are unchanged.
- A design whose only action button sits outside every Card behaves exactly
  as today.
- The same rules apply when `define_component` checks a template with
  `exampleProps`, minus the whole-design checks it already skips.

`POST /api/actions/run` (R5):

- With the three-Card design, values `{item, name}` from the second Card's
  inputs are accepted.
- These are refused with 400
  `This design has no input named "<name>" next to a "<action>" button.`:
  values that mix input names found only in different Cards; a value whose
  name exists only outside every scope of that action's enabled buttons.
  Messages name inputs, never values.
- A value that doesn't fit its input is refused as today: a Select option
  not in that Select's options, a string over 1,000 characters, a
  non-boolean for a Checkbox. A name that is a password field in the matching
  scope is refused as today.
- Designs whose action buttons are outside every Card are checked as today.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, with new tests:
  - `server/ui/formScope.test.ts` (tests `shared/formScope.ts`): nearest Card
    for node, nested-Card and Markup element paths; `sendsInput` with and
    without a Card.
  - `server/ui/bindings.test.ts`: `card` is filled.
  - `server/ui/validateTree.test.ts`: three item Cards pass; a same-Card
    duplicate; an outer button seeing two Cards; a required input missing
    from the button's Card; the per-button edit check; an unscoped design is
    unchanged.
  - `server/customComponents/definition.test.ts`: a template with two Card forms.
  - `server/ui/checkAction.test.ts`: the second Card is accepted; mixed scopes
    are refused; a name outside every scope is refused; an unscoped design is
    unchanged.
  - `server/routes/actions.test.ts`: the 400 message for a mixed request.
- `npm run build` and `npm run build:api` succeed.
