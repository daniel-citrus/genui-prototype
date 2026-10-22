---
id: eval-case-trace
priority: 20
depends: []
touches:
  - server/eval/types.ts
  - server/eval/runner.ts
  - server/eval/runner.test.ts
  - server/eval/cli.ts
  - server/eval/cli.test.ts
scope: small
---

# Return the scored trace from each eval case

## Sources

- [Eval logs plan — R1](../plans/eval-logs.md#r1-result-carries-the-trace)
- [Eval logs plan — Design](../plans/eval-logs.md#design)

## Context

`npm run eval` scores each case and then drops the turn. `runEvalCase` in `server/eval/runner.ts` saves the turn in a fresh `InMemoryTraceRepository`, calls `runAgent`, then `resetConversation`. It scores `traces.listByConversation(conversationId).at(-1)`, or `emptyTrace` when that list is empty. `emptyTrace` has `endedBy: "stopped"`, empty `completions`, and empty `userText`. The conversation id is `` `eval:${evalCase.id}:${uuid}` ``.

`EvalCaseResult` in `server/eval/types.ts` is `id`, `ok`, `failures`, optional `endedBy`, and optional `error`. It has no `trace`. `runEvalCase` already holds the `AgentTrace` it passes to `checkTrace` and does not return it. `AgentTrace` in `server/agent/trace.ts` holds `conversationId`, `userText`, `endedBy`, token and call counts, `completions` (model `content`, tool calls with `arguments` and `result`, optional `ui` tree), and optional `error`. The system prompt is not a field on the trace.

`timeoutResult` in `server/eval/cli.ts` replaces a timed-out case with `ok: false` and one failure reason `case timed out after 180 seconds`, copying `endedBy` and `error` from the partial result when those fields are set. It drops the original failures. It is not exported.

`server/eval/cli.test.ts` injects `runEvalCase` with a return value `{ id: "x", ok: true, failures: [] }` in the test that refuses to run when the agent is unavailable. `server/eval/runner.test.ts` covers a scripted heading pass (`heading-test`, prompt `Show a heading that says Hello`), a text-only fail, and conversation cleanup. Those tests do not read `result.trace`. The runner's `ToolLogger` is `noopLogger`.

## Scope

Add required `trace: AgentTrace` to `EvalCaseResult`. In `runEvalCase`, set `result.trace` to the same `trace` variable already passed to `checkTrace`, including the existing `emptyTrace` fallback. Do not change `noopLogger`, `emptyTrace`, the in-memory ports, check kinds, case files, the agent loop, or the system prompt.

Inside `timeoutResult`, copy `trace: partial.trace` onto the returned object. Leave the timeout failure as the only failure. Do not export `timeoutResult`, do not inject a timeout signal, and do not write log files. File writing and `timeoutSignal` belong to `eval-cli-logs`, which asserts a pre-aborted signal through the log file.

Update the injected `runEvalCase` return value in `server/eval/cli.test.ts` so it includes a `trace` and `npm run typecheck` still passes. A minimal trace is enough there: `conversationId`, `userText`, `endedBy`, zero counts, and `completions: []`. This goal does not add directory, writer, or redaction tests to that file.

Extend `server/eval/runner.test.ts`. Keep the conversation-cleanup test.

## Acceptance

- The scripted heading pass returns `trace.endedBy` `"reply"`, `trace.userText` equal to the case prompt `Show a heading that says Hello`, and a completion whose tool call name is `render_ui`.
- A text-only reply still returns a trace, with `endedBy` `"reply"` and no tool call named `render_ui`.
- `trace.conversationId` starts with `eval:` plus the case id.
- The in-memory conversation is still cleared after the case.
- `timeoutResult` returns `trace` equal to `partial.trace` and still replaces `failures` with the single reason `case timed out after 180 seconds`. `npm run typecheck` fails if that copy is missing. This goal does not assert it through a log file.

## Validation

- `npm test` exits 0. The new assertions live in `server/eval/runner.test.ts`, which the existing `npm test` glob `server/**/*.test.ts` already runs. Database tests skip when `DATABASE_URL` and `TRACE_DATABASE_URL` are unset.
- `npm run typecheck` exits 0.
- `npm run build` exits 0.
- `npm run build:api` exits 0.

Do not run `npm run eval`. It needs `OPENAI_API_KEY`.
