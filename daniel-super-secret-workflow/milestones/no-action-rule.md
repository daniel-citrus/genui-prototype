---
id: no-action-rule
priority: 50
depends: []
touches:
  - server/agent/systemPrompt.ts
  - server/agent/systemPrompt.test.ts
  - server/agent/tools/actions.ts
  - server/agent/tools/actions.test.ts
  - docs/ARCHITECTURE.md
scope: small
---

# Render buttons that have no fitting action

## Sources

- [Eval follow-ups — R1: Render the button when no action fits](../plans/eval-followups.md#r1-render-the-button-when-no-action-fits)
- [Eval follow-ups — R2: Flag area-only matches in list_actions](../plans/eval-followups.md#r2-flag-area-only-matches-in-list_actions)
- [Eval follow-ups — R5: Document the changed rule and note](../plans/eval-followups.md#r5-document-the-changed-rule-and-note)
- [Eval follow-ups — Interfaces](../plans/eval-followups.md#interfaces)

## Context

An eval run (`npm run eval -- --repeat 3` on main `84ee2fa`, 54/60 attempts)
failed only on buttons that no registered action fits:

- `invented-action-name` 0/3: `list_actions` returned only `demo_echo`; the
  model asked for the right action name instead of rendering, and never
  called `render_ui`.
- `newsletter-no-action` 1/3: `list_actions {"area": "other", "operation":
  "create"}` returned `match: "area"` with `demo_echo`, and the model wired
  Subscribe to `demo_echo` anyway.
- `export-pdf` 2/3: the model said it could show an Export PDF button but
  never called `render_ui`.

Current code:

- `server/agent/systemPrompt.ts` exports `SYSTEM_PROMPT`. Step 5's second
  bullet (three-space indent) reads: "Set the Button's action prop to the
  name of a returned action that fits. If no action fits, render the button
  without an action and say that clicking it won't do anything yet." The
  Rules section also says "Never invent action names; use only names
  list_actions returned." and "If the request is unclear in a way that
  changes the design, ask one short question." Both stay unchanged.
- `server/agent/systemPrompt.test.ts` asserts exact sentences with
  `includes` (including "If no action fits, render the button without an
  action" and `/won't do anything yet/`) and fails on any snake_case word
  that is not a registered tool name, so the prompt cannot name
  `demo_echo`.
- `listActionsTool` in `server/agent/tools/actions.ts`: when no action fits
  both `area` and `operation`, it returns the area's actions with
  `match: "area"` and the summary `Listed <n> actions (no exact match)`.
  Its `data` holds `match`, `actions`, `others` and, with `listChoices`,
  `choices`. An empty registry returns `match: "exact"` with empty lists.
  `server/agent/tools/actions.test.ts` has "falls back to the area's actions
  when none fit both" (`{ area: "items", operation: "delete" }`, summary
  `Listed 4 actions (no exact match)`) and an empty-registry test that
  `deepEqual`s `data: { match: "exact", actions: [], others: [] }`.
- `docs/ARCHITECTURE.md`: §3 has the paragraph starting "**`list_actions`.**",
  which mentions `match: "area"`; §4 has the bullet starting "The system
  prompt lives in".
- `render_ui` already refuses a Button `action` that is not registered
  (`server/ui/validateTree.ts`); the prompt must not rely on that.

## Scope

1. Replace only step 5's second bullet in `SYSTEM_PROMPT` with exactly this
   line (three-space indent, like its siblings); no other prompt line
   changes:

   ```text
      - Set the Button's action prop to the name of a returned action that fits: one whose description does what the button should do. If no action fits, render the button without an action and say that clicking it won't do anything yet. Do this also when the person names an action list_actions didn't return, or when only a demo or other unrelated action came back: never wire one as a stand-in. A missing action is not a reason to ask a question or to skip render_ui.
   ```

2. In `server/agent/tools/actions.ts`, add and export:

   ```ts
   /** Added to an area fallback, whose actions do something other than the operation asked for. */
   export const AREA_FALLBACK_NOTE =
     "No action fits both this area and operation, so these are the area's other actions. Use one only if its description does what the button should do; otherwise render the button without an action.";
   ```

   and build `data` as `{ match, ...(match === "area" ? { note:
   AREA_FALLBACK_NOTE } : {}), actions, others, choices? }`, with `note`
   placed right after `match` so the model reads it before the list. The
   summary string does not change.

3. In `docs/ARCHITECTURE.md`, edit the §4 system prompt bullet and the §3
   `list_actions` paragraph as described under Acceptance.

Assumptions: the rule lives in step 5, not Rules, because step 5 is where
the model decides what to wire. The prompt says "a demo or other unrelated
action" rather than naming `demo_echo`, so it holds for any registry and
passes the snake_case test. A `note` field is added instead of changing the
summary so existing summary assertions and log readers keep working. Out of
scope: changing `demo_echo`, new eval cases, the Rules section's "ask one
short question" sentence, and server-side enforcement that a turn renders.

## Acceptance

- `SYSTEM_PROMPT` contains the step 5 bullet above exactly, still contains
  "If no action fits, render the button without an action" and "won't do
  anything yet", and never names `demo_echo`.
- Every other sentence `systemPrompt.test.ts` asserts is unchanged, including
  the two Rules sentences quoted under Context, and the snake_case test
  passes.
- An area fallback (`{ area: "items", operation: "delete" }`) returns
  `data.note === AREA_FALLBACK_NOTE`, with `match: "area"`, the same
  `actions` and `others`, and the summary `Listed 4 actions (no exact
  match)`.
- An exact match has no `note` key, and neither does an empty registry
  (`match: "exact"`, empty lists; the existing `deepEqual` still passes).
- `AREA_FALLBACK_NOTE` is exported from `server/agent/tools/actions.ts` and
  is a constant: it contains no argument value, action name or description.
- The §4 system prompt bullet in `docs/ARCHITECTURE.md` says a Button with no
  fitting action is still rendered without an action, including when the
  person names an action that was not returned, that a stand-in action is
  never wired, and that a missing action is no reason to ask.
- The §3 `list_actions` paragraph says an area fallback carries a fixed
  `note`.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including new or updated tests this goal adds: in
  `server/agent/systemPrompt.test.ts`, the new bullet is present exactly;
  in `server/agent/tools/actions.test.ts`, the area fallback carries
  `note: AREA_FALLBACK_NOTE` and keeps its summary, and an exact match has
  no `note`. Database and Redis tests skip without `DATABASE_URL` and
  `REDIS_URL`.
- `npm run build` and `npm run build:api` succeed.

## After merge

- With `OPENAI_API_KEY` set, `npm run eval -- --repeat 3` shows `invented-action-name`, `newsletter-no-action` and `export-pdf` at 3/3 and every other case still 3/3 (especially `echo-form`, `archive-item`, `menu-create-item`, `menu-delete-category`).
