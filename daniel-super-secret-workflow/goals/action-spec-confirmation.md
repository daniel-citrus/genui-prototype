---
id: action-spec-confirmation
priority: 20
depends: []
touches:
  - server/actions/types.ts
  - server/actions/registry.ts
  - server/actions/registry.test.ts
  - server/actions/confirm.ts
  - server/actions/confirm.test.ts
  - shared/api.ts
  - server/routes/actions.ts
  - server/routes/actions.test.ts
  - src/main.ts
scope: medium
---

# Give action specs areas, operations, dropdown sources and a confirm step

## Sources

- [POS menu actions plan — R3: Action spec fields](../plans/pos-menu-actions.md#r3-action-specs-carry-an-area-an-operation-dropdown-sources-and-a-confirm-question)
- [POS menu actions plan — R6: Route confirmation](../plans/pos-menu-actions.md#r6-the-action-route-asks-before-running-a-confirmed-action)
- [POS menu actions plan — R7: Sandbox question](../plans/pos-menu-actions.md#r7-the-sandbox-asks-the-confirm-question-in-place)
- [POS menu actions plan — Interfaces](../plans/pos-menu-actions.md#interfaces)

## Context

A Button in a generated design can name a server-side action; clicking it posts
`POST /api/actions/run`. Today:

- `server/actions/types.ts` defines `ActionSpec` (`name`, `description`, closed
  `input_schema` of string or boolean properties), `ActionDefinition` (spec plus
  `run(values, ctx)`) and `ActionRegistry` (`specs`, `run`).
- `createActionRegistry` (`server/actions/registry.ts`) validates each
  definition, checks values against the schema, applies a 10 s timeout, turns
  throws into `{ ok: false, message: "That action failed." }`, caps messages at
  500 characters, and its `specs` copies only `name`, `description` and
  `input_schema`. The only action is `demo_echo` (`server/actions/demo.ts`),
  returned by `createActions()` in `server/actions/index.ts`.
- `server/routes/actions.ts` checks the body (`bodyProblem`), finds the
  remembered design (`getDesign`; 409 `DESIGN_GONE_MESSAGE` when gone), runs
  `checkActionRequest`, keeps only values the schema declares (`schemaValues`),
  runs the registry, and logs `{ conversationId, action, ok, durationMs }`,
  never values.
- `src/main.ts` `sendAction` reads the design's fields with
  `actionValues(readFields(controls))`, posts via `runAction`
  (`src/actionsClient.ts`, which returns a 200 body as-is when it has boolean
  `ok` and string `message`, so extra fields such as `confirm` pass through),
  shows the result with `showStatus` in the `.sandbox-status` area (outside the
  `.sandbox-canvas`), and adds a `⚡ <action>: <message>` chat line.
  `syncActionButtons` disables `button[data-action]` while busy; a `ui` event
  clears the status area.

Later goals add fourteen menu actions (three of them deletes that need
confirmation), filter `list_actions` by area and operation, and fill dropdowns
from named sources. This goal adds the spec fields they rely on and
confirmation end to end, from route to sandbox. It registers no new action, so
test with fixture definitions.

## Scope

Additive changes to `server/actions/types.ts`:

```ts
export const ACTION_OPERATIONS = ["create", "edit", "archive", "delete", "attach", "detach", "other"] as const;
export type ActionOperation = (typeof ACTION_OPERATIONS)[number];

/** Where a dropdown's values come from. Actions that share a source pass the same object. */
export interface ChoiceSource { name: string; list(signal: AbortSignal): Promise<string[]> }

export interface ActionSpec {
  name: string; description: string; input_schema: Record<string, unknown>;
  /** What the action works on, e.g. "items"; snake_case. Missing counts as "other". */
  area?: string;
  /** What it does to it. Missing counts as "other". */
  operation?: ActionOperation;
  /** Input name → dropdown source name. */
  choices?: Record<string, string>;
  /** Asked before the action runs; `{input}` is replaced with that value. Present = needs confirmation. */
  confirm?: string;
}

export interface ActionDefinition extends Omit<ActionSpec, "choices"> {
  /** Input name → where its dropdown values come from. */
  choices?: Record<string, ChoiceSource>;
  run(values: Record<string, string | boolean>, ctx: ActionContext): Promise<ActionResult>;
}

export interface ActionRegistry {
  specs: ActionSpec[];
  run(name: string, values: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult>;
  /** Current values of a source named in `specs`; rejects for an unknown name. */
  listChoices(source: string, signal: AbortSignal): Promise<string[]>;
}
```

`createActionRegistry` validation (each failure throws an error naming the
action):

- `area`, when present, matches `^[a-z][a-z0-9_]*$` and is at most 32
  characters; `operation`, when present, is one of `ACTION_OPERATIONS`.
- Each `choices` key is a declared `string` property of `input_schema` (not
  boolean, not undeclared); each source's `name` matches `^[a-z][a-z0-9_]*$`.
  Two different source objects with the same `name`, in the same or different
  actions, throw; the same object shared by several actions is fine.
- `confirm` is a non-empty string of at most 200 characters, and every
  `{placeholder}` in it names a declared property.
- `specs` includes `area`, `operation`, `choices` (as input name → source name)
  and `confirm` only when the definition has them, so `demo_echo`'s spec is
  unchanged.
- `listChoices(source, signal)` calls that source's `list(signal)` and returns
  its values; an unknown source name rejects.

`server/actions/confirm.ts` (new): `export function fillConfirm(question:
string, values: Record<string, string | boolean>): string` replaces each
`{property}` with the value as text, or `(none)` when the value is `""` or
missing.

`shared/api.ts` (additive):

```ts
export interface ActionRunRequest { conversationId: string; uiId: string; action: string; values: Record<string, string | boolean>; /** The person said yes to the action's confirm question. */ confirmed?: boolean }
export interface ActionResult { ok: boolean; message: string; /** The action did not run: ask this, then resend with confirmed: true. */ confirm?: string }
```

`server/routes/actions.ts`:

- `bodyProblem`: `confirmed` present but not a boolean is a 400 `confirmed must
  be a boolean.`
- After the body, design and `checkActionRequest` checks pass, a request for an
  action whose spec has `confirm` and without `confirmed: true` answers 200
  `{ ok: false, message: q, confirm: q }`, where `q` is `fillConfirm` over the
  schema-filtered submitted values, capped at 500 characters. The handler is not
  called. With `confirmed: true` it runs as usual. `confirmed` on an action
  without `confirm` is ignored.
- Refusals keep their order: a gone design is still 409, a failed check still
  400, whether or not `confirmed` is set.
- The info log line adds `confirmation: "asked"` or `"given"` for actions with
  `confirm` only; it still never contains values or the question.

`src/main.ts`, like CapheVietPOS's `ConfirmButton` (no browser dialog):

- When a result has `confirm`, the status area shows the question as text
  (`textContent`, never HTML) with **Yes** and **Cancel** buttons instead of a
  failed result. Give the two buttons no `data-action`.
- **Yes** resends the same action with the same values read for the first click
  plus `confirmed: true`, then shows that result and adds the chat line as usual.
- **Cancel** clears the status area and adds `⚡ <action>: cancelled` to the
  chat; nothing is sent.
- While the question is shown, the design's action buttons are disabled
  (`syncActionButtons`). A new `ui` event or a new chat turn removes the
  question without sending anything.

## Acceptance

- A malformed `area`, an unknown `operation`, a choice on an undeclared or
  boolean input, a malformed source name, two source objects sharing a name, an
  empty or over-200-character `confirm`, and a `confirm` placeholder that names
  no declared property each make `createActionRegistry` throw.
- `createActionRegistry(createActions())` still builds, and `demo_echo`'s spec
  is exactly `{ name, description, input_schema }`.
- `registry.specs` shows source names for `choices`; `listChoices` returns the
  source's values and rejects an unknown name.
- `fillConfirm("Delete the category {category}?", { category: "Trà" })` is
  `Delete the category Trà?`; an empty or missing value reads `(none)`.
- With a fixture action that has `confirm`: an unconfirmed request answers 200
  with the filled question in `message` and `confirm` and its handler is not
  called; `confirmed: true` runs it; `confirmed: "yes"` is a 400 `confirmed must
  be a boolean.`; an unknown design is still a 409; the log line has
  `confirmation` and no values or question text.
- In the browser, a result with `confirm` shows the question with Yes and
  Cancel; Yes sends the original values with `confirmed: true`; Cancel sends
  nothing and logs `⚡ <action>: cancelled`.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including new cases in `server/actions/registry.test.ts`
  and `server/routes/actions.test.ts`, and the new
  `server/actions/confirm.test.ts`.
- `npm run build` and `npm run build:api` succeed.
- R7 is DOM code in `src/main.ts` with no unit test; check it by reading the
  diff: the question uses `textContent`, and Yes reuses the first click's values.
  The in-browser delete check runs after `menu-tools-integration` merges, since
  no registered action has `confirm` until then.
