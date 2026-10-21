---
id: architecture-docs
priority: 90
depends:
  - menu-tools-integration
touches:
  - docs/ARCHITECTURE.md
scope: small
---

# Describe the POS menu actions in the architecture doc

## Sources

- [POS menu actions plan — R11: Architecture doc](../plans/pos-menu-actions.md#r11-the-architecture-doc-describes-the-menu-actions)
- [POS menu actions plan — Summary](../plans/pos-menu-actions.md#summary)

## Context

`docs/ARCHITECTURE.md` is the project's description of the running system,
with numbered sections: §1 System overview (with a diagram), §2 Browser app
(including "Action clicks"), §3 API (a table of parts), §4 A chat turn, end to
end (system prompt and "UI trees" bullets), §5 Data, §8 Repository layout, §10
Current limits and what's next ("Today" and "Planned").

Earlier goals on this branch, all merged before this one, added:

- `server/ports/PosMenu.ts`: the `PosMenu` port mirroring CapheVietPOS's
  `MenuStore` (CapheVietPOS commit 60764e5), and
  `server/adapters/pos/InMemoryPosMenu.ts`: an in-memory demo café menu seeded
  from `server/adapters/pos/fixtures.ts`, reset on every API start and shared by
  every conversation on that API instance. Name helpers live in
  `server/text/names.ts`.
- `server/actions/menu/`: fourteen menu actions registered next to `demo_echo`,
  each with an area, an operation, dropdown sources and, for the three deletes,
  a confirm question.
- `list_actions` now takes required `area` and `operation` arguments from fixed
  lists built from the registered actions, returns up to 10 matches in full with
  their dropdown choices plus one line per other action, and the system prompt
  tells the agent to find the action before picking components.
- `POST /api/actions/run` answers an unconfirmed request for an action with a
  confirm question with `{ ok: false, message, confirm }` instead of running it;
  the sandbox shows the question in place with Yes and Cancel, and Yes resends
  with `confirmed: true`.
- `render_ui` refuses a dropdown input that isn't a Select or lists a value the
  source doesn't have, and an edit form with no input for any field it could
  change.

Read the code on the base branch to confirm details before describing them.

## Scope

Edit only `docs/ARCHITECTURE.md`, keeping its style and section numbering.

## Acceptance

- §1's diagram and §3's table include the `PosMenu` port and the demo menu
  adapter; §3 describes the `list_actions` arguments and the action route's
  confirmation step.
- §2 "Action clicks" describes the in-place question.
- §4's system prompt bullet describes finding the action by area and operation
  before reading components, instead of "once per chat", and §4's "UI trees"
  bullet describes the dropdown and edit-form checks.
- §5 gains a "Demo menu" row: API memory, reset on restart, shared by everyone
  using the API.
- §8's layout lists `server/adapters/pos`, `server/actions/menu` and
  `server/text`.
- §10 "Today" says menu actions change only the in-memory demo menu, and §10
  names a live CapheVietPOS adapter as planned behind authentication.
- Every file, function and route the doc names exists on the base branch.

## Validation

- `npm run typecheck` and `npm test` still pass (no code changes).
- Check each statement above against the code on the base branch, for example
  with `grep -n` for each named file and function.

## After merge

- Read the §1, §3, §4, §5 and §10 changes in `docs/ARCHITECTURE.md` against the running app.
