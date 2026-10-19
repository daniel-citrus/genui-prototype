---
id: action-registry
priority: 10
depends: []
touches:
  - shared/api.ts
  - server/actions/types.ts
  - server/actions/registry.ts
  - server/actions/registry.test.ts
  - server/actions/demo.ts
  - server/actions/demo.test.ts
  - server/actions/index.ts
  - server/agent/run.ts
  - server/agent/run.test.ts
scope: medium
---

# Add the action registry, the demo action, and the shared action types

## Sources

- [Interactive UI actions plan — R1 Action registry](../plans/interactive-ui-actions.md#r1-action-registry)
- [Interactive UI actions plan — R2 Demo action](../plans/interactive-ui-actions.md#r2-demo-action)
- [Interactive UI actions plan — Interfaces](../plans/interactive-ui-actions.md#interfaces)
- [Interactive UI actions plan — Work breakdown](../plans/interactive-ui-actions.md#work-breakdown)

## Context

Designs the agent renders in the browser sandbox are inert. The overall
feature lets the agent attach a named backend action to a `Button`. When the
person clicks it, the browser sends the design's named input values to
`POST /api/actions/run`, and the server runs that action's handler directly,
with no model call. This goal is the foundation. It adds the server-side
registry of actions, one harmless demo action, and every `shared/api.ts`
change the feature needs, so later goals never edit that file.

The registry mirrors the agent's tool registry in
`server/agent/registry.ts` (`createToolRegistry`): snake_case names, a closed
`input_schema` compiled with the shared strict Ajv in
`server/validation/jsonSchema.ts` (`compileSchema`, `schemaProblem`,
`formatSchemaErrors`), arguments checked before `run`, and a throwing handler
turned into an `ok: false` result and logged. `ToolLogger` is exported from
`server/agent/tools.ts`.

Today the `ui` member of `AgentEvent` in `shared/api.ts` is
`{ type: "ui"; tree: UiNode }`, emitted only by `handleToolCall` in
`server/agent/run.ts`
(`showUi: (tree) => run.emit({ type: "ui", tree })`). `server/agent/run.test.ts`
asserts that exact event. Making `id` required breaks both, so this goal
also makes `showUi` add an id. Remembering designs by id is a later goal
(`design-memory`). The browser (`src/main.ts`) reads only `event.tree` and
keeps compiling.

## Scope

`shared/api.ts`, additive except the `ui` event's new required `id`:

```ts
/** Longest text value an action input may send. */
export const MAX_FIELD_CHARS = 1000;
export interface ActionRunRequest {
  conversationId: string;
  /** The `id` of the `ui` event that drew the design. */
  uiId: string;
  action: string;
  /** Named input values; password fields never included. */
  values: Record<string, string | boolean>;
}
export interface ActionResult { ok: boolean; message: string }
// AgentEvent's ui member becomes: { type: "ui"; id: string; tree: UiNode }
```

`server/actions/types.ts` (new):

```ts
export interface ActionContext { conversationId: string; log: ToolLogger; signal: AbortSignal }
export interface ActionSpec { name: string; description: string; input_schema: Record<string, unknown> }
export interface ActionDefinition extends ActionSpec {
  run(values: Record<string, string | boolean>, ctx: ActionContext): Promise<ActionResult>;
}
export interface ActionRegistry {
  specs: ActionSpec[];
  run(name: string, values: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult>;
}
```

`server/actions/registry.ts` (new) exports `createActionRegistry(definitions)`,
`ACTION_TIMEOUT_MS = 10_000` and `MAX_ACTION_MESSAGE_CHARS = 500`. Give
`createActionRegistry` a way to set a shorter timeout, such as an optional
second options argument, so tests don't wait 10 s. Its doc comment must say
that handlers get only schema-checked string and boolean values, and must use
parameterised queries and never a shell.

`server/actions/demo.ts` (new) exports `demoEchoAction`. `server/actions/index.ts` (new)
exports `createActions(): ActionDefinition[]`, which returns `[demoEchoAction]`.
The demo is registered in every environment. Nothing registers the action
registry with the app or the agent yet; later goals do that.

`server/agent/run.ts`: `showUi` becomes
`(tree) => run.emit({ type: "ui", id: randomUUID(), tree })`, using
`node:crypto`. Update `server/agent/run.test.ts` to expect a string `id`.

## Acceptance

- `createActionRegistry` throws for any of these:
  - a name that doesn't match `^[a-z][a-z0-9_]*$`
  - a duplicate name
  - an `input_schema` that is not `type: "object"` with `additionalProperties: false`
  - an `input_schema` that Ajv rejects
  - a property whose `type` is not `"string"` or `"boolean"`
  - a property with no `description`
- `run(name, values, ctx)` for an unregistered name returns `{ ok: false, message: "Unknown action: <name>" }` and calls no handler.
- Values that break the action's schema return `ok: false`, with a message that lists the problems, and the handler is not called.
- A handler that throws returns `{ ok: false, message: "That action failed." }` and logs the error through `ctx.log.error`.
- A handler still running after the timeout returns `{ ok: false, message: "That action took too long." }`, and the signal the handler received is aborted. That signal also aborts when `ctx.signal` aborts.
- A result `message` longer than 500 characters is cut to 500.
- `specs` lists `{ name, description, input_schema }` for every action, in definition order.
- `demo_echo`'s schema has exactly one property, an optional string `text` with `maxLength` 1000 and a description. With `text` it returns `{ ok: true, message: "Demo action received: <text>" }`, and without it `{ ok: true, message: "Demo action ran." }`. It writes nothing and makes no network calls.
- `createActionRegistry(createActions())` does not throw.
- Every `ui` event `handleToolCall` emits has an `id` that is a random UUID, and the `tree` is the one `render_ui` checked.

## Validation

- `npm run typecheck` passes.
- `npm test` passes. It includes the new `server/actions/registry.test.ts`,
  which this goal adds, covering every case above (use a short injected
  timeout), and the new `server/actions/demo.test.ts`, covering both messages.
  The updated `server/agent/run.test.ts` checks that the `ui` event has a
  UUID `id`.
- `npm run build` and `npm run build:api` succeed.
