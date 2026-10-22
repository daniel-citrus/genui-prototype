---
id: eval-checks
priority: 10
depends: []
touches:
  - server/eval/types.ts
  - server/eval/loadCases.ts
  - server/eval/loadCases.test.ts
  - server/eval/checks.ts
  - server/eval/checks.test.ts
scope: small
---

# Load eval cases and score an AgentTrace

## Sources

- [Eval harness plan — R1](../plans/eval-harness.md#r1-case-file-format)
- [Eval harness plan — R2](../plans/eval-harness.md#r2-deterministic-trace-checks)
- [Eval harness plan — Interfaces](../plans/eval-harness.md#interfaces)
- [Eval harness plan — eval-checks](../plans/eval-harness.md#work-breakdown)

## Context

There is no `server/eval/` directory. Chat already records each turn as an `AgentTrace` in `server/agent/trace.ts`. `runAgent` in `server/agent/loop.ts` fills one per turn and saves it through `TraceRepository`. Later goals add a runner that calls `runAgent` and a CLI that scores live OpenAI turns. This goal only lands the case file contract and the deterministic checkers. Do not add a runner, CLI, `package.json` script, case fixtures under `server/eval/cases/`, or docs. Do not change the agent loop, routes, system prompt, or traces adapter.

`AgentTrace` includes `conversationId`, `userText`, `endedBy` (`"reply" | "max_steps" | "tool_budget" | "token_budget" | "stopped"`), counts, `completions`, and optional `error`. Each completion has `toolCalls: AgentTraceToolCall[]`. A tool record is `{ call: { id, name, args }, result: { ok, summary, data? }, skipped?, ui?: { id, tree } }`. `ui` is present only when `render_ui` succeeded and emitted a tree.

`MAX_MESSAGE_CHARS` is 4000 in `shared/api.ts`. `collectBindings` in `server/ui/bindings.ts` walks a tree (including Markup) and returns `{ inputs: { name }[], buttons: { action }[] }`. Tests use `node:test` and `node:assert/strict`, same as `server/agent/loop.test.ts`. `npm test` already globs `server/**/*.test.ts`. `tsconfig.server.json` already includes `server`.

## Scope

Add `server/eval/types.ts` (types only, no I/O):

```ts
import type { EndedBy, AgentTrace } from "../agent/trace";

export type EvalCheck =
  | { endedBy: EndedBy }
  | { noError: true }
  | { toolCalled: string }
  | { toolSucceeded: string }
  | { uiComponent: string }
  | { uiButtonAction: string }
  | { uiNamedInput: string };

export interface EvalCase {
  id: string;
  prompt: string;
  checks: EvalCheck[];
}

export interface CheckFailure {
  check: EvalCheck;
  reason: string;
}

export interface EvalCaseResult {
  id: string;
  ok: boolean;
  failures: CheckFailure[];
  endedBy?: EndedBy;
  error?: string;
}
```

Add `loadCases(dir: string): EvalCase[]` in `server/eval/loadCases.ts`. Read `*.json` in `dir` (caller passes the directory; default folder for later goals is `server/eval/cases`). Sort the returned cases by `id`. Validate every file before returning any case. A check object must have exactly one of the `EvalCheck` keys. `noError` must be `true`. Refuse extra fields on the case or on a check. `id` must be unique across files and match kebab-case `[a-z0-9]+(?:-[a-z0-9]+)*`. `prompt` must be non-empty and at most `MAX_MESSAGE_CHARS`. `checks` must be non-empty. A file that fails that shape, is not a JSON object, or is invalid JSON throws a clear error and no case is returned. Load does not call a model.

Add `checkTrace(trace: AgentTrace, checks: EvalCheck[]): CheckFailure[]` in `server/eval/checks.ts`. Empty array means every check passed. Score from the trace alone: no second model and no exact tree equality.

- `endedBy` passes when `trace.endedBy` equals the given value.
- `noError` passes when `trace.error` is omitted.
- `toolCalled` passes when any recorded `completions[].toolCalls[]` entry has that `call.name` (skipped calls still count).
- `toolSucceeded` passes when any recorded call has that `call.name`, `result.ok === true`, and `skipped` omitted.
- The last successful `render_ui` tree is the last `AgentTraceToolCall` (completions in order, then that completion's `toolCalls`) with `call.name === "render_ui"`, `result.ok`, `ui` set, and `skipped` omitted.
- `uiComponent` passes when some node of that tree has `component` equal to the given catalog name (walk `children`).
- `uiButtonAction` passes when `collectBindings` on that tree has a button whose `action` equals the given name.
- `uiNamedInput` passes when `collectBindings` on that tree has an input whose `name` equals the given name.
- If there is no last successful `render_ui` tree, every UI check fails with a reason that says so (do not throw).
- A failing check's `reason` names the check and must not include `userText`, completion text, tool arguments, or a UI tree.

## Acceptance

- Valid JSON files with `id`, `prompt`, and a non-empty `checks` array load; ids across files are unique; results are sorted by `id`.
- A missing `id`, empty or non-kebab `id`, empty `prompt`, `prompt` longer than 4000, empty `checks`, unknown check key, two keys on one check, `noError` other than `true`, extra case field, extra check field, duplicate `id`, or invalid JSON throws a clear error and returns no case.
- `loadCases` does not import or call an LLM adapter.
- Each allowed check passes and fails against fixture traces as specified above, including UI checks with no successful `render_ui`.
- Fail reasons name the check and omit `userText`, completion text, tool arguments, and tree JSON.

## Validation

- `npm test` includes `server/eval/loadCases.test.ts` and `server/eval/checks.test.ts` (this goal adds them): a valid pair of files loads; each refusal in Acceptance throws and yields no case; one fixture trace per check that passes and one that fails; UI checks with no `render_ui`; a fixture whose `userText` is distinctive, whose fail reason does not contain that text.
- `npm run typecheck` passes.
- `npm run build` and `npm run build:api` pass.

## After merge

- None. Later goals add the runner, live CLI, and committed cases.
