---
id: actions-docs
priority: 90
depends:
  - action-route
  - sandbox-actions
touches:
  - docs/ARCHITECTURE.md
  - README.md
scope: small
---

# Document UI actions in the architecture doc and README

## Sources

- [Interactive UI actions plan — R12 Documentation](../plans/interactive-ui-actions.md#r12-documentation)
- [Interactive UI actions plan — Validation (after merge)](../plans/interactive-ui-actions.md#validation)
- [Interactive UI actions plan — Risks](../plans/interactive-ui-actions.md#risks)

## Context

The earlier goals of this feature made rendered designs interactive.
`docs/ARCHITECTURE.md` is the project's map, and it still describes the
sandbox as inert ("nothing typed or clicked in it reaches the agent", §10).

The shipped feature works like this; read the merged code to confirm the
details:

- **Action registry** (`server/actions/`): named handlers with closed
  string/boolean input schemas. Values are checked before a handler runs,
  and handlers have a 10 s timeout and a 500-character message cap. One
  side-effect-free action, `demo_echo`, is registered.
- **Catalog:** `Button` takes an optional `action`, and `TextInput`,
  `Checkbox` and `Select` take an optional `name`. `render_ui` refuses
  duplicate names, unregistered actions, missing required inputs, mistyped
  bindings, and bound password inputs.
- **Agent:** the agent has a `list_actions` tool and is prompted to attach
  actions only from that list. Clicks never reach the agent.
- **Designs:** each `ui` SSE event carries a server-generated `id`. The
  server remembers each conversation's last five designs in memory, beside
  its history, and loses them on restart or eviction.
- **Route:** `POST /api/actions/run` checks the click against the remembered
  design, filters the values to the action's schema, and runs the handler
  with no model call. It responds 200 `{ ok, message }`, or 400, 409, 413 or
  429. It has a 32 KB body cap and a per-IP rate limit counted separately
  from chat (same `AGENT_RATE_LIMIT_PER_MINUTE`), and it logs no values.
- **Browser:** the sandbox sends the named values (never passwords) and
  shows the result in a status area above the design, plus a `⚡ <action>:
  <message>` line in the chat. Action buttons are disabled while a request
  or chat turn is in flight.
- **Catalog seed:** changes reach Postgres only through `npm run db:seed` in
  development. Until it runs, `render_ui` rejects `action` and `name` props.
- **Not built yet:** authentication is required before any side-effecting
  action ships.

## Scope

Update `docs/ARCHITECTURE.md` and, where it lists routes or development
steps, `README.md`. Don't change code.

## Acceptance

- The §1 diagram and §3 table include the action registry and the
  `/api/actions/run` route.
- §2 describes the click flow and no longer calls the UI inert.
- §4 notes the `ui` event `id` and the binding checks in `render_ui`.
- §5 notes the remembered designs (five per conversation, in memory).
- §8 lists `server/actions/`.
- In §10, "Today" describes actions, the demo-only action set and the
  missing authentication. "Planned" names real, side-effecting actions,
  which need authentication first.
- Every SSE event list in the doc shows the `ui` event with its `id`.
- The doc or README says that `npm run db:seed` must run after pulling
  catalog changes, or `render_ui` rejects `action` and `name` props.

## Validation

- Every relative link added to `docs/ARCHITECTURE.md` or `README.md` points to a file that exists (check each with `test -e`).
- `npm run typecheck` and `npm test` still pass. This goal changes no code,
  so this only confirms the base is healthy.

## After merge

- With `OPENAI_API_KEY` set, ask the agent for "a form that sends a short note with the demo action": it calls `list_actions`, the design renders, and clicking shows "Demo action received: ..." above the design and a `⚡ demo_echo: ...` line in the chat.
- Press Stop while the agent re-renders a design, then click the older design's button: the action still runs.
- Restart the API and click the button again: "This design is no longer available. Ask the agent to show it again." appears above the design.
- Leave a required named field empty and click: the browser shows its validation message and no request is sent.
