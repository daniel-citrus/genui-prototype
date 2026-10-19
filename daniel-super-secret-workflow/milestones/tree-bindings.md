---
id: tree-bindings
priority: 30
depends:
  - action-registry
touches:
  - server/catalog/components.ts
  - server/catalog/validate.test.ts
  - server/ui/bindings.ts
  - server/ui/validateTree.ts
  - server/ui/validateTree.test.ts
  - server/agent/tools/actions.ts
  - server/agent/tools/actions.test.ts
  - server/agent/tools/ui.ts
  - server/agent/tools/ui.test.ts
  - server/agent/tools/index.ts
  - server/agent/systemPrompt.ts
  - server/agent/systemPrompt.test.ts
  - server/index.ts
scope: medium
---

# Let the agent bind Buttons to actions and inputs to action properties

## Sources

- [Interactive UI actions plan — R3 Catalog bindings](../plans/interactive-ui-actions.md#r3-catalog-bindings)
- [Interactive UI actions plan — R4 Binding checks in render_ui](../plans/interactive-ui-actions.md#r4-binding-checks-in-render_ui)
- [Interactive UI actions plan — R5 Agent can discover and attach actions](../plans/interactive-ui-actions.md#r5-agent-can-discover-and-attach-actions)
- [Interactive UI actions plan — Components](../plans/interactive-ui-actions.md#components)

## Context

The overall feature lets the agent attach a named backend action to a
`Button` in a rendered design. When the person clicks it, the browser sends
the design's named input values to the server, which runs the action. This
goal gives the agent the means to do that, and makes `render_ui` refuse
bindings that couldn't work, while the agent can still fix them.

This builds on `action-registry`, which added `server/actions/`:
`createActionRegistry(definitions)` returns `{ specs, run }`, `ActionSpec` is
`{ name, description, input_schema }`, and `createActions()` returns the
registered definitions (today only `demo_echo`, with one optional string
property `text`). Action schemas allow only `string` and `boolean`
properties.

Current code:

- `server/catalog/components.ts` has twelve components. `Button` props are
  `label`, `variant`, `size` and `disabled`. `TextInput` has `label`,
  `placeholder`, `type` (`text`, `email`, `password`, `number`) and
  `required`. `Checkbox` has `label` and `checked`. `Select` has `label`,
  `options` and `placeholder`.
  `validateCatalog` (`server/catalog/validate.ts`) requires a `description` on
  every property and a closed object schema. The seed (`npm run db:seed`)
  carries changes to Postgres. `props_schema` is JSON, so no migration is
  needed.
- `server/ui/validateTree.ts`: `validateUiTree(tree, catalog)` checks shape,
  names, props, children rules, `MAX_DEPTH` 8 and `MAX_NODES` 100, and returns
  at most `MAX_ERRORS` 20 messages, with paths like `tree.children.0`.
- `server/agent/tools/index.ts`: `createAgentTools({ components })` returns
  `list_components`, `get_component` and `render_ui`
  (`server/agent/tools/ui.ts`, which calls `validateUiTree` and then
  `ctx.showUi(tree)`). `server/index.ts` builds the tool registry with
  `createToolRegistry(createAgentTools({ components }))`.
- `server/agent/systemPrompt.ts` currently says "nothing the person types
  into a rendered design reaches you".
  `server/agent/systemPrompt.test.ts` fails if the prompt leaves out a
  registered tool, or names any other snake_case word, so the prompt must
  not mention `demo_echo`.

## Scope

- **Catalog:** add an optional `action` prop to `Button`, and an optional
  `name` prop to `TextInput`, `Checkbox` and `Select`, as specified in
  Acceptance.
- **`server/ui/bindings.ts` (new):** add `collectBindings(tree)`. It returns
  the named inputs (path, component, the TextInput `type`, the Select
  `options`) and the action Buttons (path, action, disabled). The
  `action-route` goal reuses it to check click requests, so keep it
  independent of `validateUiTree`.
- **`validateUiTree(tree, catalog, actions?: ActionSpec[])`:** always check
  for duplicate names. Run the action checks only when `actions` is passed.
- **`server/agent/tools/actions.ts` (new):** add `listActionsTool(actions)`.
- **`createAgentTools({ components, actions })`:** `actions` is
  `ActionSpec[]` and optional, defaulting to `[]`, so existing test callers
  stay unchanged. It always includes `list_actions`. `render_ui` passes
  `actions` to `validateUiTree`.
- **`server/index.ts`:** build the action registry once, with
  `createActionRegistry(createActions())`, in a variable the `action-route`
  goal will also pass to the app, and pass its `specs` to `createAgentTools`.
- **System prompt:** rewrite as Acceptance describes.

## Acceptance

- `Button.action`: a string with pattern `^[a-z][a-z0-9_]*$`, `maxLength` 64,
  and a description that tells the agent to choose a name from `list_actions`.
- `name` on TextInput, Checkbox and Select: a string with pattern
  `^[A-Za-z][A-Za-z0-9_]*$`, `maxLength` 64, described as the key the value is
  sent under, unique in the design.
- `validateCatalog(catalog)` returns no problems, and every existing
  component's `exampleProps` still validates.
- Two inputs with the same `name` anywhere in the tree are an error naming
  both paths.
- A Button whose `action` is not in `actions` is an error that suggests calling
  `list_actions`.
- For each action used by a Button that is not disabled, every `required`
  property of the action's schema must be the `name` of an input in the tree.
  Otherwise there is an error naming the action and the missing input.
- An input whose `name` is a property of an action that a Button in the tree
  uses must match that property's type: `boolean` needs a Checkbox, and
  `string` needs a TextInput that isn't `type: "password"`, or a Select.
  A mismatch is an error, and so is a password TextInput bound to an action
  property.
- These errors count toward `MAX_ERRORS` like any others. A tree with no
  `action` and no `name` props gives exactly the same result as before, with
  or without `actions`.
- `list_actions` takes no arguments (closed empty schema), returns
  `ok: true` with `data` listing each action's `name`, `description` and
  `input_schema`, and has the summary `Listed N actions`.
- `render_ui` refuses a tree whose Button uses an unregistered action and
  shows nothing.
- The system prompt says:
  - call `list_actions` when the request implies a button should do something;
  - set the Button's `action` to a listed name;
  - give each input a `name` equal to the action property it fills;
  - never invent action names;
  - when no action fits, render the button without one and say that clicking
    it won't do anything yet;
  - clicks do not reach the agent.

  It no longer says that nothing typed into a design reaches anyone.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including these new or extended tests:
  - `server/catalog/validate.test.ts`: the catalog is still valid.
  - `server/ui/validateTree.test.ts`: the existing "accepts every catalog
    component's example props" test still passes. New cases cover new props
    accepted, bad `action` and `name` patterns refused, duplicate names, an
    unregistered action, a missing required input, a Checkbox bound to a
    string property, a bound password input, a disabled Button skipped, and
    no `actions` behaving as before.
  - `server/agent/tools/ui.test.ts`: `render_ui` refuses an unregistered
    action.
  - `server/agent/tools/actions.test.ts` (new): `list_actions` output.
  - `server/agent/systemPrompt.test.ts`: passes with `list_actions` included.

  Database tests skip without `DATABASE_URL`.
- `npm run build` and `npm run build:api` succeed.

## After merge

- Run `npm run db:seed` against the seeded development database: Button, TextInput, Checkbox and Select are reported as updated, and a second run reports them unchanged.
