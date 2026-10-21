---
id: render-ui-checks
priority: 30
depends:
  - action-spec-confirmation
touches:
  - server/ui/validateTree.ts
  - server/ui/validateTree.test.ts
  - server/agent/tools/ui.ts
  - server/agent/tools/ui.test.ts
scope: medium
---

# Make render_ui check dropdown options and refuse edit forms with nothing to change

## Sources

- [POS menu actions plan — R12: Dropdown checks](../plans/pos-menu-actions.md#r12-render_ui-checks-dropdowns-against-their-source)
- [POS menu actions plan — R13: Edit-form check](../plans/pos-menu-actions.md#r13-render_ui-refuses-an-edit-form-with-nothing-to-change)
- [POS menu actions plan — Interfaces](../plans/pos-menu-actions.md#interfaces)

## Context

The agent shows a design by calling `render_ui` (`server/agent/tools/ui.ts`,
`renderUiTool(components, actions)`), which calls the synchronous
`validateUiTree(tree, catalog, actions)` in `server/ui/validateTree.ts`. Its
`bindingProblems` uses `collectBindings` (`server/ui/bindings.ts`: named inputs
with `path`, `component` (`TextInput` | `Checkbox` | `Select`), `name`, and a
Select's string `options`; Buttons with `path`, `action`, `disabled`). Today it
refuses unregistered actions ("call list_actions to see them"), a missing input
for a required property on each action's first enabled Button, and inputs of
the wrong kind for the property they fill (checked for every Button naming the
action, disabled or not). It never compares a Select's options with anything,
and never requires optional inputs.

This builds on `action-spec-confirmation`, which adds optional `operation` (one
of `create`, `edit`, `archive`, `delete`, `attach`, `detach`, `other`) and
`choices` (input name → dropdown source name) to `ActionSpec` in
`server/actions/types.ts`, and `ActionRegistry["listChoices"]` (`(source,
signal) => Promise<string[]>`), which loads a source's current values.

Later the menu actions (`menu-actions`) declare sources such as `menu_items`,
and `menu-tools-integration` passes the real `listChoices` from
`createAgentTools` to `renderUiTool`. Neither is merged yet, and
`server/agent/tools/index.ts` is not part of this goal: test with fixture specs
and a fake `listChoices`, calling `renderUiTool` directly inside
`createToolRegistry`.

## Scope

- `export function renderUiTool(components: ComponentRepository, actions:
  ActionSpec[], listChoices?: ActionRegistry["listChoices"]): ToolDefinition`.
  For every source named in `choices` of an action that some Button in the tree
  names (disabled or not), it calls `listChoices(source, ctx.signal)` once per
  source per call, then calls `validateUiTree` with the sources that loaded. A
  source that rejects is skipped (logged with `ctx.log.error`); the rest of the
  tree is still checked. Without `listChoices`, nothing is loaded.
- `export function validateUiTree(tree: unknown, catalog: Component[],
  actions?: ActionSpec[], choiceValues?: Record<string, string[]>):
  UiTreeCheck`, still synchronous.
- R12, in `bindingProblems`, only for sources present in `choiceValues`: for an
  input that fills a property with `choices` on an action a Button names:
  - not a Select: `<path> fills "item" of action "menu_update_item", which takes
    one of the menu_items values: use a Select with those values as options`;
  - a Select option that is not exactly one of the source's values:
    `<path>.props.options "Latte" is not one of the menu_items values (call
    list_actions to get them)`. A subset of the values is fine.
- R13, in `bindingProblems`, using only the specs (so it runs whether or not
  `choiceValues` is given): for the first enabled Button of each action whose
  `operation` is `edit` and whose schema has at least one optional property
  (declared but not in `required`), require an input named after at least one
  of those optional properties; otherwise `<button path> action
  "menu_update_item" changes nothing without an input for one of: name,
  description, category`, listing the optional properties in schema order. A
  disabled Button is not checked; actions with any other or no `operation` are
  not checked.

## Acceptance

- With fixture specs whose `item` input takes values from a source listing
  "Bạc xỉu" and "Cà phê sữa đá": a Select listing both, or only one, passes; a
  Select listing "Latte", or "Bac xiu" without accents, is refused with the
  message above; a TextInput named `item` is refused; a source missing from
  `choiceValues` is not checked.
- With a fake `listChoices`, `render_ui` loads each source once per call even
  when several inputs or actions use it; a rejecting source skips its check and
  is logged; without `listChoices` nothing is loaded.
- An `edit` action with only required inputs in the tree is refused, naming its
  optional properties in schema order; one optional input passes; a disabled
  Button isn't checked; a `create` action, or one without `operation`, with only
  required inputs passes. An `edit` action whose schema has no optional
  properties is never refused by this rule.
- Existing `render_ui` and `validateUiTree` tests pass unchanged (`demo_echo`
  has no `choices` and no `edit` operation).

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including new cases in `server/ui/validateTree.test.ts` and
  `server/agent/tools/ui.test.ts`.
- `npm run build:api` succeeds.
