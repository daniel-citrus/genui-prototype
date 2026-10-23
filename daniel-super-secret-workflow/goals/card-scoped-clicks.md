---
id: card-scoped-clicks
priority: 30
depends:
  - card-scoped-checks
touches:
  - src/sandbox/render.ts
  - src/sandbox/components.ts
  - src/main.ts
  - server/ui/formScope.test.ts
  - docs/ARCHITECTURE.md
scope: small
---

# Send only the clicked button's Card fields from the sandbox

## Sources

- [Component generation plan — R6 Card-scoped clicks in the sandbox](../plans/data-driven-components-and-card-forms.md#r6-card-scoped-clicks-in-the-sandbox)
- [Component generation plan — Errors and edge cases](../plans/data-driven-components-and-card-forms.md#errors-and-edge-cases)

## Context

This builds on `card-scoped-checks`, which added `shared/formScope.ts`
(`nearestCard(tree, path)` and `sendsInput(tree, buttonPath, inputPath)`,
paths in `validateUiTree` form such as
`"tree.children.0.props.root.children.1"`) and made the server accept an
action request only when all its values fit one scope of an enabled button:
the nearest Card around the button, or the whole design when it has none.
With several per-item Cards sharing input names, the browser today would send
every field, so same-named fields overwrite each other in `values` and the
server refuses the request.

Current browser code:

- `src/sandbox/render.ts` `draw(node)` walks the tree recursively without
  paths and calls the component renderer with `(props, children)`;
  `renderUi(tree, container)` draws the whole tree.
- `src/sandbox/components.ts` holds the renderers (`Card` draws a `section`;
  `setName` names a control). Markup roots are drawn through `filterMarkup`
  (`src/sandbox/markup.ts`), which uses the same `sanitizeMarkup` as the
  server.
- `src/main.ts` keeps `shownUiId` (set from the `ui` event). A click on
  `button[data-action]` calls `sendAction(action)`, which reads every
  `input, select` in the sandbox, refuses when a named one is hidden
  (`isHidden`), runs `checkValidity()` / `reportValidity()`, and posts
  `ActionRunRequest` (`shared/api.ts`) through `postAction`. A confirm
  question resends the first click's request when the person answers Yes.

Markup attributes can't set `data-*`, so a `data-path` the renderer adds
can't be forged by a design. The `chat-thinking-indicator` and
`new-chat-button` goals (from the plain chat plan) also edit `src/main.ts`, in
the chat-stream and header code rather than the sandbox click path; keep
your change to the sandbox click and shown-tree code.

## Scope

- `draw` passes each node's path (`"tree"`, `"tree.children.0"`, …) to its
  renderer. Each drawn control (TextInput, Checkbox, Select, and Markup
  `input`/`select`) and each action button (Button and Markup `button` with an
  `action`) gets its tree path in a `data-path` attribute. Markup elements get
  their path under `props.root` (`…props.root.children.<i>`), counted on the
  received root before filtering, so they match the server's paths.
- `src/main.ts` keeps the shown tree next to `shownUiId`, passes the clicked
  button to `sendAction`, and keeps only the controls whose `data-path`
  `sendsInput(shownTree, buttonPath, controlPath)` puts in the clicked
  button's scope. The hidden-field refusal and `checkValidity` run on those
  controls only.
- The confirm flow is unchanged.
- Update the sandbox section of `docs/ARCHITECTURE.md`.

There is no DOM library in `npm test`, so the DOM wiring is covered by the
after-merge check; the path logic is covered through `formScope` tests that
use the sandbox's path scheme.

## Acceptance

- Clicking Save in the second of three item Cards (each with a Select `item`,
  a TextInput `name` and a Button `menu_update_item`) sends that Card's
  `item` and `name` only.
- The hidden-field refusal and the browser's required-field validation apply
  to the fields being sent, not to fields in other Cards.
- Each drawn control and action button carries `data-path`; `sendAction`
  keeps the controls whose path the shared function puts in the clicked
  button's scope.
- Paths count Markup children as they appear in the received tree, so they
  match the server's paths, including Markup controls inside a Card in a
  custom component template.
- A design whose action button sits outside every Card sends every named
  field, as today.
- The confirm flow (Yes resends the first click's values) is unchanged.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, with new cases in `server/ui/formScope.test.ts` that use
  the sandbox's control paths: Markup controls inside a Card in a template,
  a button outside every Card, and nested Cards.
- `npm run build` and `npm run build:api` succeed.

## After merge

- Run `npm run dev` (Postgres up, `npm run db:seed` done), ask for an ordinary form with a button that runs an action, click it, and confirm in the network tab that its fields are still sent and the action result shows (the per-item Card check comes with `agent-guidance`).
