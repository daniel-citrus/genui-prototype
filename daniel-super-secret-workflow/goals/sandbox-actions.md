---
id: sandbox-actions
priority: 50
depends:
  - action-registry
touches:
  - src/sandbox/components.ts
  - src/sandbox/actionValues.ts
  - src/sandbox/actionValues.test.ts
  - src/actionsClient.ts
  - src/main.ts
scope: medium
---

# Send a Button's action from the sandbox and show the result

## Sources

- [Interactive UI actions plan — R9 Sandbox sends actions](../plans/interactive-ui-actions.md#r9-sandbox-sends-actions)
- [Interactive UI actions plan — R10 Sandbox shows results](../plans/interactive-ui-actions.md#r10-sandbox-shows-results)
- [Interactive UI actions plan — Interfaces](../plans/interactive-ui-actions.md#interfaces)
- [Interactive UI actions plan — Errors and edge cases](../plans/interactive-ui-actions.md#errors-and-edge-cases)

## Context

The overall feature lets the agent give a `Button` an `action` prop and give
`TextInput`, `Checkbox` and `Select` a `name` prop. When the person clicks a
Button that has an action, the browser posts the design's named values to
`POST /api/actions/run`. The server checks the request against the design it
rendered, runs the handler, and replies `200 { ok, message }`. On errors it
replies `{ error: { message } }`: 400 for a mismatch, 409 when the design is
no longer remembered, 413, or 429 from the rate limiter (body
`{ statusCode, message }`). This goal is the browser half. The server route
lands in a parallel goal (`action-route`), so it might not exist when this
goal is built. Test against the wire contract.

This builds on `action-registry`, which added the following to
`shared/api.ts`:

- `ActionRunRequest`:
  `{ conversationId, uiId, action, values: Record<string, string | boolean> }`
- `ActionResult`: `{ ok: boolean; message: string }`
- `MAX_FIELD_CHARS` (1000)
- the `ui` event's new `id`: `{ type: "ui"; id: string; tree: UiNode }`

Current browser code:

- `src/sandbox/components.ts` draws each catalog component. Button is
  `type="button"` with no handler, and props are read defensively with the
  `str` and `bool` helpers.
- `src/sandbox/render.ts` `renderUi(tree, container)` replaces the sandbox
  contents.
- `src/main.ts` holds `conversationId`. It renders `ui` events into
  `.sandbox-canvas`, appends lines to the chat thread (`appendLine`,
  `toolLineClass`, `errorLineClass`), and tracks the streaming turn in
  `activeTurn`. It drops every event that arrives after Stop, so the shown
  design may be older than the newest one the server sent.
- `src/agentClient.ts` shows how this app maps fetch errors
  (`{ error: { message } }` → message).
- Browser tests are DOM-free (see `src/sandbox/componentNames.test.ts`), and
  there is no DOM test environment.

## Scope

- **Renderers:** Button sets `data-action` only when `action` is a string
  matching `^[a-z][a-z0-9_]*$` and `disabled` is not true. TextInput,
  Checkbox and Select set the element's `name` attribute from the `name`
  prop. TextInput sets `maxLength` to `MAX_FIELD_CHARS`.
- **`src/sandbox/actionValues.ts` (new):** a pure helper with no DOM
  access.

  ```ts
  export interface FieldReading { name: string; kind: "text" | "password" | "checkbox" | "select"; value: string; checked: boolean }
  export function actionValues(fields: FieldReading[]): Record<string, string | boolean>;
  ```

- **`src/actionsClient.ts` (new):**
  `runAction(req: ActionRunRequest, signal?: AbortSignal): Promise<ActionResult>`.
  Network and HTTP failures resolve to `{ ok: false, message }`, worded as
  in Acceptance.
- **`src/main.ts`:**
  - remember the `id` of the `ui` event that drew the shown design;
  - add a status area above `.sandbox-canvas`, outside the drawn tree, with
    `role="status"`;
  - handle clicks on `button[data-action]` in the sandbox, for example with
    one delegated listener;
  - manage disabling as described in Acceptance.

## Acceptance

Sending:

- On click, the browser runs native validity on every input and select in the
  design. If one is invalid, it calls `reportValidity()` on it and sends
  nothing.
- Values come from named fields: a TextInput gives its value, and password
  inputs are left out entirely. A Checkbox gives `checked` as a boolean. A
  Select gives its value, which is `""` when the placeholder is still
  selected.
- The request carries `conversationId`, the shown design's `ui` event `id`
  as `uiId`, the Button's action, and the values.

Disabling:

- While an action request is in flight, or a chat turn is streaming, every
  `button[data-action]` in the sandbox is disabled.
- They are re-enabled afterwards, including buttons in a design drawn during
  the turn. Buttons the design itself disables stay disabled.

Results:

- The result appears in the status area: green-toned for `ok: true`, and
  red-toned for `ok: false` or an HTTP error. The message is set through
  `textContent`.
- A new design or a new action result replaces what the status area shows.
- The chat thread gets one small line per action: `⚡ <action>: <message>`.
- A network failure shows "Couldn't reach the server.". Other failures show
  the response's error message (`error.message`, or `message` for a 429), or
  `Request failed (<status>)` when there is none.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including the new `src/sandbox/actionValues.test.ts`,
  which this goal adds. It covers password fields left out, checkbox booleans,
  a select's empty value, and text values passed through.
- `npm run build` succeeds.
