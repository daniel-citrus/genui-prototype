---
id: action-route
priority: 50
depends:
  - tree-bindings
  - design-memory
touches:
  - server/ui/checkAction.ts
  - server/ui/checkAction.test.ts
  - server/routes/actions.ts
  - server/routes/actions.test.ts
  - server/app.ts
  - server/index.ts
scope: medium
---

# Add POST /api/actions/run, checked against the remembered design

## Sources

- [Interactive UI actions plan — R7 Action route](../plans/interactive-ui-actions.md#r7-action-route)
- [Interactive UI actions plan — R8 Abuse limits on the action route](../plans/interactive-ui-actions.md#r8-abuse-limits-on-the-action-route)
- [Interactive UI actions plan — R11 No values in logs](../plans/interactive-ui-actions.md#r11-no-values-in-logs)
- [Interactive UI actions plan — Interfaces](../plans/interactive-ui-actions.md#interfaces)
- [Interactive UI actions plan — Security](../plans/interactive-ui-actions.md#security)

## Context

The overall feature lets a Button in a rendered design run a backend action.
The browser sends the conversation id, the `uiId` of the design it shows, the
Button's action, and its named input values. The browser is untrusted, so
the server re-derives from its own copy of the design what that click may
send. It then runs the handler directly, with no model call.

Earlier goals provide these pieces:

- `action-registry` added the following:
  - `shared/api.ts`: `ActionRunRequest`
    `{ conversationId, uiId, action, values: Record<string, string | boolean> }`,
    `ActionResult` `{ ok, message }`, and `MAX_FIELD_CHARS` (1000).
  - `server/actions/`: `createActionRegistry`, `ActionRegistry`
    (`{ specs, run(name, values, ctx) }`, where `ctx` is
    `{ conversationId, log, signal }`), and `createActions()`.

  `registry.run` validates values against the action's schema, catches
  handler errors and timeouts, and always resolves to an `ActionResult`.
- `tree-bindings` added `collectBindings(tree)` in `server/ui/bindings.ts`. It
  returns the named inputs (path, component, TextInput `type`, Select
  `options`) and the action Buttons (path, action, disabled). It also has
  `server/index.ts` build the registry once with
  `createActionRegistry(createActions())`.
- `design-memory` added `getDesign(conversationId, uiId): UiNode | undefined`
  in `server/agent/conversations.ts`. It covers the last five designs of
  each conversation.

Current code:

- `server/routes/agent.ts` (`POST /api/agent/chat`) is the pattern to
  follow. It uses `bodyLimit` 32 KB and `config: { rateLimit: {} }`, and
  errors are `{ error: { message } }`.
- `server/rateLimit.ts` registers `@fastify/rate-limit` with `global: false`.
  Each route with `config.rateLimit` gets its own child store, so a second
  route counts separately from chat. The limit is `AGENT_RATE_LIMIT_PER_MINUTE`,
  passed to `buildApp` as `rateLimit: { max }`. The limiter runs before the
  body is parsed, and its 429 keeps the chat wording ("Too many messages. Try
  again in N seconds.") with a `Retry-After` header.
- `server/app.ts` `buildApp(deps: AppDeps)` registers routes. Several test
  files call `buildApp` without any action registry.
- `MAX_NODES` (100) is exported from `server/ui/validateTree.ts`.

## Scope

- **`server/ui/checkAction.ts` (new):** add
  `checkActionRequest(tree, action, values)`. It returns `{ ok: true }` or
  `{ ok: false; message }` and is built on `collectBindings`.
- **`server/routes/actions.ts` (new):** add `actionsRouter`, with
  `POST /run`, registered at `/api/actions`.
- **`AppDeps` in `server/app.ts`:** add `actions?: ActionRegistry`. When it
  is omitted, the route uses `createActionRegistry([])`, so existing
  `buildApp` callers in tests stay unchanged.
- **`server/index.ts`:** pass the registry it already builds.
- **Handler context:** the route passes the handler `{ conversationId, log:
  req.log, signal }`, where the signal aborts if the client disconnects.

## Acceptance

Requests and status codes:

- The body is
  `{ conversationId: string, uiId: string, action: string, values: object }`.
  These give 400 with `{ error: { message } }`:
  - a missing or wrong-typed field
  - a value that is not a string or boolean
  - more than 100 values
- An unknown `conversationId` or `uiId` gives 409 with the message "This
  design is no longer available. Ask the agent to show it again."
- An `action` that is not on a Button without `disabled: true` in that
  design gives 400.
- These values give 400:
  - a key that is not the `name` of an input in that design
  - any value for a password TextInput
  - a TextInput value that is not a string, or is longer than 1000 characters
  - a Checkbox value that is not a boolean
  - a Select value that is neither `""` nor one of its options
- A valid request runs the handler with only the values whose keys the
  action's schema declares, so an unrelated named field doesn't reach it.
  The response is 200 `{ ok, message }`, including `ok: false` results from
  the registry, such as schema errors.

Abuse limits:

- The route has `bodyLimit` 32 KB, and a larger body gets 413.
- `config: { rateLimit: {} }`: past `AGENT_RATE_LIMIT_PER_MINUTE` requests per
  IP per minute, the route gives 429 with `Retry-After`. Chat and action
  counters are separate, and the limiter runs before the body is parsed.

Logging:

- Each action request logs one info line with `conversationId`, `action`, `ok`
  and `durationMs`, and nothing from `values`.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including:
  - New `server/ui/checkAction.test.ts`: covers every 400 rule above.
  - New `server/routes/actions.test.ts`, using `buildApp` with a test action
    registry and designs remembered through `rememberDesign`:
    - 400 for each malformed body
    - 409 for an unknown design, and for an unknown conversation
    - a disabled Button refused
    - a password value refused
    - Select options checked
    - values filtered to the schema's keys
    - 200 with `ok: false`
    - 413
    - 429 while chat on the same IP is still allowed
    - a captured log line with no `values` key and no submitted string
- `npm run build:api` succeeds.
