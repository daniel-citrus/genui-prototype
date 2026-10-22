---
id: custom-component-render
priority: 40
depends:
  - custom-component-definitions
touches:
  - server/agent/tools/ui.ts
  - server/agent/tools/ui.test.ts
  - server/agent/tools/index.ts
scope: medium
---

# Expand custom components in render_ui before validating and showing

## Sources

- [Custom components plan: R8, R5 (Markup only in templates), Design (Tools)](../plans/custom-components.md#r8-expansion-in-render_ui)

## Context

`render_ui` (`server/agent/tools/ui.ts`, `renderUiTool(components, actions, listChoices?)`) works like this today:
1. It loads the catalog with `components.list()`.
2. It loads the current values of the dropdown sources named by the design's action Buttons (`choiceSources`, `loadChoices`).
3. It runs `validateUiTree(tree, catalog, actions, choiceValues)`.
4. On success it calls `ctx.showUi(tree)`, which (in `server/agent/run.ts`) remembers the tree for clicks (`rememberDesign`) and emits the `ui` event the browser draws.

`createAgentTools` in `server/agent/tools/index.ts` builds the tools from `{ components, actions, listChoices }`.

The goals already merged give you the rest:
- `custom-component-store` added `CustomComponentRepository` (`server/ports/CustomComponentRepository.ts`; `getByName` returns the current version, deleted ones included with `deletedAt`) and its fake `server/ports/fakes/InMemoryCustomComponentRepository.ts`, plus the limits in `shared/customComponents.ts` (`MAX_EXPANDED_NODES` 400, `MAX_EXPANDED_DEPTH` 24).
- `markup-component` added the `Markup` catalog component and the `validateUiTree` options (`designChecks`, `maxNodes`, `maxDepth`).
- `custom-component-definitions` added `expandTree(tree, { catalog, resolve })` and `rewritePaths(errors, origins)` in `server/customComponents/expand.ts`. Expansion returns `{ tree, errors, origins }` with only catalog components in `tree`, and refuses deleted components in the agent's own tree.

Because the server stores and sends the expanded tree, a design already drawn never changes when a definition is later updated or deleted, and clicks are checked against exactly what the browser shows.

## Scope

- `renderUiTool(components, actions, listChoices?, customComponents?)`: a new optional fourth parameter of type `CustomComponentRepository`. Without it, behavior and messages stay exactly as today.
- With it, `render_ui` does the following, in order:
  1. Check the agent's own tree:
     - each node whose `component` is `Markup` is refused with "Markup can only be used inside a custom component; define one with define_component";
     - the tree stays within today's 8 levels and 100 nodes, with a custom node counting as one.
  2. `expandTree(tree, { catalog, resolve: (name) => customComponents.getByName(name) })`.
  3. Load dropdown values from the expanded tree's bindings, which include Markup inputs.
  4. `validateUiTree(expanded.tree, catalog, actions, choiceValues, { maxNodes: MAX_EXPANDED_NODES, maxDepth: MAX_EXPANDED_DEPTH })`.
  5. Combine `expanded.errors` with `rewritePaths(validatorErrors, expanded.origins)`, capped at 20 (the last line summarizing the rest), and return them as today's `{ ok: false, summary: "UI has N problems", data: { errors } }`.
  6. On success, call `ctx.showUi(expanded.tree)` and report stats of the expanded tree.
- The "not in the catalog" message for an unknown name gains "(did you mean X?)" over custom component names too: a case-insensitive match from `customComponents.list({ search })` or `getByName`.
- `createAgentTools` gains an optional `customComponents?: CustomComponentRepository` and passes it to `renderUiTool`. Don't add other tools here (`custom-component-agent-tools` does), and don't change `server/index.ts`.
- A repository failure (for example Postgres down) logs the error and returns `{ ok: false, summary: "Custom components are unavailable" }`, and only when the tree uses a name that isn't in the catalog. A design made only of catalog components never touches the repository.

## Acceptance

- Without `customComponents`, every existing `ui.test.ts` case passes unchanged.
- With a fake repository holding `MenuItemCard`, a tree using it:
  - is validated after expansion;
  - `showUi` receives a tree containing only catalog components;
  - the result's stats count the expanded nodes.
- A tree with `Markup` directly in it is refused with the "define one with define_component" message, even when the Markup itself is valid.
- A custom instance with a missing required prop is refused with the agent's path (`tree.children.0.props.price is required`).
- A problem inside a template is reported as `tree.children.0 (MenuItemCard v1) template…`.
- A Markup button with an unregistered action inside a custom component is refused. One with a registered action, whose required inputs are in the design, renders, and `checkActionRequest` on the remembered (expanded) tree accepts a click for it.
- A deleted custom component in the agent's tree is refused with the restore-or-replace message.
- The agent's own tree over 100 nodes is refused, while an expanded tree of up to 400 nodes and 24 levels is accepted.
- A catalog-only design makes no repository call. A repository that throws gives the "unavailable" result only for trees that use custom names.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including new cases in `server/agent/tools/ui.test.ts` that use `InMemoryComponentRepository` with the real `catalog` and `InMemoryCustomComponentRepository` (no database, no OpenAI key).
- `npm run build:api` passes.
