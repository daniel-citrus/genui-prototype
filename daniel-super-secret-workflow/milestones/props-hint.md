---
id: props-hint
priority: 50
depends: []
touches:
  - server/ui/validateTree.ts
  - server/ui/validateTree.test.ts
  - server/customComponents/expand.ts
  - server/customComponents/expand.test.ts
  - server/customComponents/definition.test.ts
  - server/agent/tools/ui.test.ts
  - docs/ARCHITECTURE.md
scope: small
---

# Point props-schema problems at get_component

## Sources

- [Props error recovery plan: R1, R2, Design, Validation](../plans/props-error-recovery.md#r1-point-catalog-props-problems-at-get_component)

## Context

In the 2026-10-22 eval run the `price-tag` case failed: the model sent
`define_component` a template `{"component": "Markup", "props": {"markup": "<span>…</span>"}, "children": []}`
with guessed props, never having called `get_component Markup`. It got
`Definition has 2 problems` with `template.props.root is required` and
`template.props.markup is not allowed`, and nothing in those errors said where
to read Markup's real props. This goal adds that pointer.

How props errors are produced today:

- `formatSchemaErrors` (`server/validation/jsonSchema.ts`) turns Ajv errors
  into `is required`, `is not allowed`, or Ajv's message.
- `propsErrors(validate, props, path)` (`server/ui/validateTree.ts`, around
  line 99) formats each as `<path>.props<.prop> <message>`; `propMessage`
  lists enum values.
- `validateUiTree` (`server/ui/validateTree.ts`, around line 229) calls
  `propsErrors` for each node whose component is in the catalog: once when
  `node.props` is an object, once with `{}` when props are missing. It then
  runs `validateMarkup` on a Markup `root`. It ends with
  `limitErrors([...sizeProblems, ...errors])`.
- `expandTree` (`server/customComponents/expand.ts`, around line 135) calls
  `propsErrors(propsValidator(custom), node.props ?? {}, where)` for each
  custom-component use inside `expandCustom` (around line 199), where
  `custom.name` is the stored component's name.
- `render_ui` (`server/agent/tools/ui.ts`) joins `expandTree` problems and
  `validateUiTree` errors, rewrites template paths (`rewritePaths`), caps them
  (`limitErrors`, 20) and returns `UI has N problems` with `data.errors`.
- `define_component` (`server/agent/tools/customComponents.ts`) returns
  `Definition has N problems` with errors from `validateDefinition`
  (`server/customComponents/definition.ts`). That function expands
  `{component: name, props: exampleProps}` and validates the result only when
  the props schema and example props already passed, then maps
  `tree (<Name> v0) template` back to `template`.
- Other messages already carry parenthesised hints, such as
  `(did you mean X?)` and `(call list_actions to see them)`. The new hint
  follows that style.
- Markup's only required prop is `root`, an element tree
  (`server/catalog/components.ts`, `shared/markup.ts`).

## Scope

- Add and export from `server/ui/validateTree.ts`:

  ```ts
  /**
   * `problems` from `propsErrors` for a use of `name`, the first one saying
   * where to read its props unless `hinted` already has `name`. Adds `name` to
   * `hinted`, so one check names each component once.
   */
  export function withPropsHint(problems: string[], name: string, hinted: Set<string>): string[];
  ```

  It returns `problems` unchanged when it is empty or `hinted` has `name`.
  Otherwise it returns a new array whose first entry is
  `` `${problems[0]} (call get_component ${name} for its props)` `` and adds
  `name` to `hinted`.
- `validateUiTree` creates one `hinted` set per call and passes both
  `propsErrors` results through `withPropsHint` with `component.name`.
- `expandTree` creates one `hinted` set per call and passes the instance
  `propsErrors` result through `withPropsHint` with `custom.name`.
- `propsErrors`, `validateUiTree` and `expandTree` keep their signatures. Tool
  result shapes (`ok`, `summary`, `data.errors`) don't change.
  `render_ui`, `define_component`, `validateDefinition`, `rewritePaths`,
  `limitErrors` and `formatSchemaErrors` don't change.
- No hint on problems that don't come from `propsErrors`: unknown component,
  `props must be an object`, children on a leaf, Markup element problems from
  `validateMarkup`, bindings, and size limits.
- Enum problems still get the hint when they come first.
- `render_ui` runs `expandTree` then `validateUiTree`, each with its own set;
  catalog names win during expansion, so a name is hinted at most once per
  call. Hint text only ever names a resolved catalog or stored custom name,
  never raw model input.
- In `docs/ARCHITECTURE.md`, add one sentence to the **UI trees** bullet
  (around line 208) saying the first props problem per component in a check
  ends with `(call get_component <Name> for its props)`. Do not edit the
  system prompt bullet (around line 205); the `prompt-retry-rule` goal owns it.

## Acceptance

- `withPropsHint([], "X", set)` returns `[]` and leaves `set` empty; the first
  call for a name hints only the first entry and adds the name; a later call
  for the same name returns its input unchanged.
- `validateUiTree` on `{"component": "Markup"}` reports exactly
  `tree.props.root is required (call get_component Markup for its props)`.
- A Stack with four Buttons that each break the schema differently reports
  four problems; only the first ends with
  ` (call get_component Button for its props)`, the other three are unchanged.
- Two different catalog components with props problems in one tree each get a
  hint on their own first problem.
- Unknown component, `props must be an object`, children on a leaf, Markup
  element, binding and size problems carry no hint.
- Problem counts are unchanged: `UI has N problems` and
  `Definition has N problems` report the same N as before.
- Through `define_component`, the price-tag template
  `{"component": "Markup", "props": {"markup": "<span><strong>{{price}}</strong></span>"}, "children": []}`
  reports `template.props.root is required (call get_component Markup for its props)`
  and `template.props.markup is not allowed`.
- Through `render_ui`, a Button without `label` at `tree.children.0` reports
  `tree.children.0.props.label is required (call get_component Button for its props)`.
- A use of a stored custom component that breaks its `propsSchema` in several
  ways gets the hint on its first problem only.
- Two uses of the same custom component with bad props in one tree name it
  once; uses of two different custom components each get one hint.
- In `define_component`, a definition whose `exampleProps` break its own
  `props_schema` reports the existing schema problems with no hint naming the
  unsaved component.
- Template paths still rewrite as before: a problem in a template node reads
  `tree.children.0 (MenuItemCard v3) template…` with the hint at the end.

## Validation

- `npm run typecheck` passes.
- `npm test` passes (repository tests skip without `DATABASE_URL`, Redis
  tests without `REDIS_URL`). This goal adds and updates tests:
  - `server/ui/validateTree.test.ts`: new tests for `withPropsHint` (empty,
    first use, already hinted), one hint per name across four Button
    problems, separate hints for two names, and no hint on the non-props
    problems above. Update "reports props that break the schema" and
    "checks the root only when it is an object".
  - `server/customComponents/expand.test.ts`: one hint per custom name across
    two uses, separate hints for two names. Update "refuses bad instance props
    and children with the agent's paths and leaves the node out" and "splices
    the instance's children into the slot and maps them back to the agent's
    paths".
  - `server/customComponents/definition.test.ts`: the price-tag template
    reports the hinted `template.props.root` problem; example props that break
    their own schema get no hint naming the definition. Update "refuses
    catalog prop and Markup problems in the expanded example".
  - `server/agent/tools/ui.test.ts`: update "shows nothing and returns the
    errors for an invalid tree" (and check the summary count is unchanged)
    and "reports instance and template problems in the agent's terms".
- `npm run build` and `npm run build:api` succeed.

## After merge

- Run `npm run eval` three times with `OPENAI_API_KEY` set (after `prompt-retry-rule` also merges): `price-tag` passes each time and other cases match `eval-logs/2026-10-22T22-04-52.968Z` (`export-pdf` may still fail).
