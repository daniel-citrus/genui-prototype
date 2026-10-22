---
id: eval-check-tool-not-called
priority: 10
depends: []
touches:
  - server/eval/types.ts
  - server/eval/checks.ts
  - server/eval/checks.test.ts
  - server/eval/loadCases.ts
  - server/eval/loadCases.test.ts
scope: small
---

# Add toolNotCalled eval trace check

## Sources

- [Eval cases plan — R1, R2](../plans/eval-cases.md#r1-toolnotcalled-check)
- [Eval cases plan — Design](../plans/eval-cases.md#design)

## Context

The eval harness in `server/eval/` loads JSON cases, runs `runAgent` with in-memory ports, and scores the saved `AgentTrace` via `checkTrace` in `server/eval/checks.ts`. Check kinds today are `endedBy`, `noError`, `toolCalled`, `toolSucceeded`, and UI checks (`uiComponent`, `uiButtonAction`, `uiNamedInput`). `toolCalled` matches any tool call of that name, including skipped calls.

Mockup and off-topic live cases (added in a follow-on goal) need the inverse: fail when a forbidden tool was called. This goal adds `{ toolNotCalled: string }` to the type union, loader, and checker before those case files land.

## Scope

- Extend `EvalCheck` in `server/eval/types.ts` with `{ toolNotCalled: string }`.
- In `server/eval/loadCases.ts`, add `"toolNotCalled"` to allowed check keys and parse it like `toolCalled` (non-empty string, exactly one key per check object).
- In `server/eval/checks.ts`:
  - `checkLabel`: `toolNotCalled "<name>"`.
  - In `evaluateCheck`, after the `toolSucceeded` branch and before UI checks: if `"toolNotCalled" in check`, scan completions the same way `toolCalled` does (any `toolCall.call.name` match, skipped or not). Pass when none match; fail with reason `${label}: tool was called`.
- Unit tests in `checks.test.ts` and `loadCases.test.ts` for the behaviors below.
- Do not add case JSON files or change `cli.test.ts` committed-case snapshots here.

## Acceptance

- `checkTrace` passes `{ toolNotCalled: "list_actions" }` when the trace has no `list_actions` call.
- `checkTrace` fails when any completion includes a `list_actions` tool call, including a skipped call.
- Fail reasons for `toolNotCalled` name the check label and `"tool was called"` only; they must not contain `userText`, completion text, tool args, or tree JSON (existing leak tests in `checks.test.ts` should still cover `checkTrace` overall).
- `loadCases` accepts a check `{ "toolNotCalled": "list_actions" }`.
- `loadCases` refuses `{ "toolNotCalled": "" }` and refuses a check with both `toolCalled` and `toolNotCalled`.

## Validation

- `npm run typecheck` exits 0.
- `npm test` exits 0, including new or updated tests in `server/eval/checks.test.ts` and `server/eval/loadCases.test.ts` for `toolNotCalled`.

## After merge

- None required for this goal alone; live cases that use `toolNotCalled` are validated after `eval-live-cases` merges.
