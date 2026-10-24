---
id: design-check
priority: 10
depends: []
touches:
  - server/generate/checkDesign.ts
  - server/generate/checkDesign.test.ts
  - server/agent/tools/ui.ts
  - server/agent/tools/ui.test.ts
  - server/agent/tools/menuTools.test.ts
  - server/ui/validateTree.ts
  - server/log.ts
  - server/agent/tools.ts
  - server/actions/types.ts
scope: medium
---

# Extract the render_ui checks into checkDesign

## Sources

- [Simplify genui plan — R2](../plans/simplify-to-generator-tool.md#r2-the-same-design-checks-as-render_ui)
- [Simplify genui plan — Design, Interfaces](../plans/simplify-to-generator-tool.md#design)

## Context

genui is becoming a one-call UI generator. The checks a generated tree must pass live today inside `render_ui` in `server/agent/tools/ui.ts`. The new generator (a later goal) needs them outside the agent. They keep a prompt-injected or careless design from drawing unsafe Markup, unregistered actions or broken forms.

The checks, in this order:

1. `ownTreeProblems`: refuses Markup `input`, `select` and `button` directly in a design; enforces unexpanded limits `MAX_NODES` 100 and `MAX_DEPTH` 8 from `server/ui/validateTree.ts`. Its over-size message currently says to "put the repeated part in a custom component".
2. `expandDesign`: runs `expandTree` (`server/customComponents/expand.ts`) and suggests custom component names.
3. `omitEmptyChildren` (`server/ui/omitEmptyChildren.ts`) drops empty children arrays.
4. `choiceSources` and `loadChoices` load the dropdown values the tree's actions use.
5. `validateUiTree` checks the expanded tree under `MAX_EXPANDED_NODES` 400 and `MAX_EXPANDED_DEPTH` 24.
6. `rewritePaths` and `limitErrors` (at most 20) shape the problem list.

Existing tests: `server/agent/tools/ui.test.ts` and `server/agent/tools/menuTools.test.ts`. `ToolLogger` is currently imported from `server/agent/tools.ts` by `server/actions/types.ts`.

## Scope

- Create `server/log.ts` exporting `Logger` with `info`, `debug`, `error`, `warn`, each `(obj: object, msg?: string): void`. Keep `ToolLogger` as an alias of it in `server/agent/tools.ts` so the old agent keeps compiling.
- Create `server/generate/checkDesign.ts` exporting:

```ts
export class CustomComponentsUnavailableError extends Error {}
export interface DesignCheckDeps {
  catalog: Component[];
  actions: ActionSpec[];
  listChoices?: ActionRegistry["listChoices"];
  customComponents?: CustomComponentRepository;
  log: Logger;
  signal: AbortSignal;
}
export type DesignCheck =
  | { ok: true; tree: UiNode; stats: UiTreeStats }
  | { ok: false; problems: string[] };
export function checkDesign(tree: unknown, deps: DesignCheckDeps): Promise<DesignCheck>;
```

- Move the body of `render_ui` there. `server/agent/tools/ui.ts` becomes a thin wrapper that calls `checkDesign` and then `ctx.showUi`, so the chat keeps working.
- Reword the too-many-nodes hint: it says to simplify the design or reuse a listed custom component, and no longer suggests defining one.
- A custom component repository failure while checking makes `checkDesign` reject with `CustomComponentsUnavailableError`.
- Move the check-focused cases from `ui.test.ts` and `menuTools.test.ts` to `server/generate/checkDesign.test.ts`; keep wrapper-level tests (showUi wiring) where they are.

## Acceptance

- `checkDesign(tree, deps)` returns `{ ok: true, tree, stats }` with the expanded tree after `omitEmptyChildren`, or `{ ok: false, problems }` with at most 20 problems.
- Every case in the existing tests that is about the checks gives the same result through `checkDesign`: Markup controls refused in a design; the 100-node/8-level unexpanded and 400-node/24-level expanded limits; unknown and deleted custom components with path rewriting; unregistered actions, required action properties nothing fills, and wrong kind of input; choices checked against loaded values; a disabled Select with no value; an edit form that sends no optional field.
- The too-many-nodes message no longer tells the reader to define a custom component.
- A custom component repository failure during checking rejects with `CustomComponentsUnavailableError`.
- The chat agent still behaves as before through the `render_ui` wrapper.

## Validation

- `npm run typecheck`, `npm test`, `npm run build`, `npm run build:api` all pass.
- `server/generate/checkDesign.test.ts` (new, introduced by this goal) covers the checks above, the reworded message and `CustomComponentsUnavailableError`.
