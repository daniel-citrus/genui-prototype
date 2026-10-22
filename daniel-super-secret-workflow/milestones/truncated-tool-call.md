---
id: truncated-tool-call
priority: 40
depends: []
touches:
  - server/agent/openaiTools.ts
  - server/agent/openaiTools.test.ts
  - server/agent/loop.ts
  - server/agent/loop.test.ts
scope: small
---

# Skip a tool call whose arguments were cut off

## Sources

- [Eval improvements — R2](../plans/eval-improvements.md#r2-cut-off-tool-arguments)

## Context

`runTurn` in `server/agent/loop.ts` emits `TRUNCATED_NOTICE` (`"The reply was cut off because it was too long."`) when `turn.truncated` is set, then parses every tool call with `parseToolArguments` and either runs it or skips it. The skip branches are the tool budget and a duplicate `seen` key. `skipCall` records a `tool_result` without running the tool and returns the string stored as the tool history message. `skipReason` maps only `"Stopped before this ran."` to `"stopped"`, `"Already called with these arguments"` to `"duplicate"`, and `"Tool budget used up"` to `"budget"`. `ToolSkipReason` in `server/agent/trace.ts` is those three strings. Any other summary is recorded with no `skipped` field.

`parseToolArguments` in `server/agent/openaiTools.ts` trims the raw string and returns `{}` when `JSON.parse` throws or yields anything other than a non-null, non-array object. `server/agent/openaiTools.test.ts` already expects `{}` for `""`, whitespace, `"{"`, `"[]"`, and a JSON string. The registry then rejects `{}` when the tool schema requires `tree`, which is why a cut-off `render_ui` currently comes back as `Invalid arguments for render_ui` with `/tree is required`.

`server/agent/loop.test.ts` drives the loop with `scriptedLlm`, `stubTools` (its `ran` array), `makeRun`, `getHistory`, and `run.traces`. The test "notices a reply that was cut off" expects `TRUNCATED_NOTICE` for a truncated text reply. `LlmTurn.truncated` is optional. A tool history message from `skipCall` is the raw sentence, which the budget test asserts on `row.content`.

A truncated completion whose arguments are a complete JSON object still runs, including a huge but valid tree. Raising `DEFAULT_MAX_OUTPUT_TOKENS` is out of scope. Several tool calls in one truncated completion are judged one by one.

## Scope

Add this function next to `parseToolArguments`:

```ts
export function jsonObjectArguments(raw: string): Record<string, unknown> | undefined
```

Trim, then `JSON.parse`. Return the value when it is a non-null, non-array object. Return `undefined` for a parse failure, `null`, an array, a string, a number, or a boolean. `parseToolArguments` keeps returning `{}` when this is `undefined`, and keeps returning the object when parsing succeeds. The existing `parseToolArguments` tests stay.

In the tool-call loop inside `runTurn`, before the budget and duplicate branches, skip a call when `turn.truncated` is true and `jsonObjectArguments` of the raw `arguments` string is `undefined`. Use `skipCall` with summary `Call was cut off` and history content `This call was cut off before its arguments finished. Call it again with a smaller tree.` Do not run the tool. Do not add the call to `seen`, so a later finished call is not treated as a duplicate of the unfinished payload. Leave the `toolCalls` increment where it is, so a skipped call still counts toward the turn the way a budget or duplicate skip does.

Do not add a `ToolSkipReason`. `skipReason` stays limited to stopped, duplicate, and budget, so this result has no `skipped` field. The trace summary is the tool result summary `Call was cut off`.

A truncated completion whose arguments are a complete JSON object falls through to the existing budget, duplicate, and run path. A completion that is not truncated keeps today's parsing, including turning broken JSON into `{}` and then running the tool. `TRUNCATED_NOTICE` is still emitted when a completion is truncated, before the tool calls are handled.

## Acceptance

- A scripted turn with `truncated: true` and arguments `{` does not call the tool. The `tool_result` summary is `Call was cut off`. The tool history message is `This call was cut off before its arguments finished. Call it again with a smaller tree.` The trace entry for that call has that summary and no `skipped` field. `TRUNCATED_NOTICE` is emitted. The following completion still runs.
- A scripted turn with `truncated: true` and arguments `{"tree":{"component":"Divider"}}` runs the tool with those arguments.
- A scripted turn that is not truncated, with unfinished arguments, still runs the tool with `{}`. `parseToolArguments` still returns `{}` for `""`, whitespace, `"{"`, `"[]"`, and a JSON string. `jsonObjectArguments` returns `undefined` for those and returns the object for a JSON object.
- One truncated completion that contains a finished JSON call and an unfinished call runs the finished call and skips the unfinished one with `Call was cut off`.
- The result of a cut-off call is not `Invalid arguments for render_ui` and does not include `/tree is required`.
- The existing test that a truncated text reply emits `TRUNCATED_NOTICE` still passes.

## Validation

- `npm test` exits 0, including `server/agent/openaiTools.test.ts` and `server/agent/loop.test.ts`.
- `npm run typecheck` exits 0.
