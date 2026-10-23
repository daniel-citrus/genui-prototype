---
id: retry-after-fix
priority: 20
depends: []
touches:
  - server/agent/tools.ts
  - server/agent/registry.ts
  - server/agent/registry.test.ts
  - server/agent/tools/customComponents.ts
  - server/agent/loop.ts
  - server/agent/loop.test.ts
  - docs/ARCHITECTURE.md
scope: small
---

# Let an identical tool call run again after a successful write

## Sources

- [Component generation plan — R11 Retries after a fix](../plans/data-driven-components-and-card-forms.md#r11-retries-after-a-fix)
- [Merged plan — Fix retries after component changes](../abandoned/custom-component-decision-flow.md#1-fix-retries-after-component-changes)

## Context

`server/agent/loop.ts` `runTurn` keeps a `seen` set of
`callKey(name, args)` (`server/agent/guardrails.ts`) and adds every call's key
before running it. Any later identical call in the turn is skipped with the
summary "Already called with these arguments" and the model is told
"You already called `<tool>` with these arguments in this turn; use that
result." That includes failed calls and calls made after a component changed.

Confirmed bug, reproducible with the real tools:

1. Save a component whose optional `title` prop fills a Heading's required
   text, with a valid title in its example props.
2. Render an instance with no title; validation correctly fails.
3. Redefine the component so `title` has a default.
4. Retry the identical render: the loop rejects it as a duplicate, although
   calling the renderer directly now succeeds.

Other relevant code:

- `server/agent/tools.ts` defines `ToolDefinition` (`name`, `description`,
  `input_schema`, `run`) and `ToolRegistry` (`specs`, `run`).
- `server/agent/registry.ts` `createToolRegistry` builds the registry.
- `server/agent/tools/customComponents.ts` defines `define_component` and
  `delete_component`, the only tools that change stored state.
- `server/agent/run.ts` `handleToolCall` returns `ToolOutcome`
  `{ content, isError }`; `isError` is `!result.ok`.
- Skipped calls count toward `MAX_TOOL_CALLS_PER_TURN`; `skipReason` maps the
  "Already called with these arguments" summary to the trace skip reason
  `duplicate`.
- `server/agent/loop.test.ts` has "does not rerun an identical call, and
  counts it toward the budget" and a "looks up components with the real
  tools" test to model the regression on;
  `server/ports/fakes/InMemoryCustomComponentRepository` is the in-memory
  repository.

No prerequisites. `template-each` edits the `define_component` template
description in `server/agent/tools/customComponents.ts`; only add the
`writes` flag there. The later `build-recovery` goal also edits `loop.ts`.

## Scope

- `ToolDefinition` gains `writes?: true`; set it on `define_component` and
  `delete_component`. `ToolRegistry` gains `writes(name: string): boolean`.
- `runTurn` keeps `seen`, cleared after each successful write, and `written`,
  the keys of successful writes, never cleared. An identical call is skipped
  (same summary and message as today) when its key is in `written`, or in
  `seen`. Prefer this over any cache-invalidation scheme.
- Keep the existing tool, step and token limits.
- Update the loop guardrails description in `docs/ARCHITECTURE.md`.

## Acceptance

- Regression, using the real tools and a fake model: the four steps above end
  with the identical `render_ui` running and succeeding.
- An identical `get_component` or `list_components` after a successful
  `define_component` or `delete_component` runs again.
- An identical call with no successful write in between is still skipped as
  "Already called with these arguments", whether the earlier one passed or failed.
- An identical `define_component` after it already succeeded in this turn is
  skipped, even after another write, and the repository holds one new version.
- Skipped calls still count toward `MAX_TOOL_CALLS_PER_TURN`, and the trace
  records them as `duplicate`.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, with new tests:
  - `server/agent/loop.test.ts`: the retry regression with the real tools; a
    re-read after a write; an identical call with no write between is still
    skipped; a repeated successful define is skipped with one version saved;
    skips count toward the budget.
  - `server/agent/registry.test.ts`: `writes()` is true for tools defined with
    `writes: true` and false otherwise (including unknown names).
- `npm run build` and `npm run build:api` succeed.
