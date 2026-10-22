---
id: agent-trace-loop
priority: 50
depends:
  - agent-trace-store
touches:
  - server/agent/loop.ts
  - server/agent/loop.test.ts
scope: medium
---

# Record every agent turn into a stored trace

## Sources

- [Agent trace plan — Loop records every turn](../plans/agent-trace.md#r3-loop-records-every-turn)
- [Agent trace plan — Tool outcomes on the completion](../plans/agent-trace.md#r4-tool-outcomes-on-the-completion)
- [Agent trace plan — Counts-only usage log](../plans/agent-trace.md#r5-counts-only-usage-log)
- [Agent trace plan — Design](../plans/agent-trace.md#design)

## Context

This builds on `agent-trace-store`, which provides `EndedBy` and the other types in `server/agent/trace.ts`, plus `rememberTrace` / `getTraces` and `MAX_TRACES_PER_CONVERSATION` on [server/agent/conversations.ts](../../server/agent/conversations.ts).

[server/agent/loop.ts](../../server/agent/loop.ts) (`runAgent`, `runTurn`) appends the user message, calls `llm.complete` up to `MAX_STEPS` (10), runs tools through [server/agent/run.ts](../../server/agent/run.ts) (`handleToolCall`), and stops on a reply with no tool calls. Caps and duplicate detection are in [server/agent/guardrails.ts](../../server/agent/guardrails.ts): 20 tool calls per turn, 150,000 tokens, `callKey` for repeats. `EndedBy` is still a private type in the loop. In a `finally` block the loop logs `{ conversationId, steps, toolCalls, promptTokens, completionTokens, endedBy }` at `info` with message `agent turn finished`.

`runAgent` emits `FORGOTTEN_NOTICE` before `runTurn` when `run.resume` is set and the conversation is unknown. That notice is not a field on the trace.

`handleToolCall` emits `tool_call`, runs the registry, and emits `tool_result`. `showUi` assigns a UUID, calls `rememberDesign`, and emits `ui`. If the run is already aborted it does not run the tool and emits `{ ok: false, summary: "Stopped before this ran." }`. The loop's `skipCall` emits the same pair with `"Tool budget used up"` or `"Already called with these arguments"` without running the tool. Arguments on the SSE `tool_call` event are parsed with `parseToolArguments` (object), not the raw JSON string kept in history.

Do not change `run.ts`, the SSE contract in [shared/api.ts](../../shared/api.ts), or guardrail constants. Do not add a traces HTTP route.

[server/agent/loop.test.ts](../../server/agent/loop.test.ts) uses `scriptedLlm` and captures events via `run.emit`. Usage-log tests collect `log.info` objects and `assert.deepEqual` the six fields. Tests call `resetConversation` so state does not leak. Reuse those helpers.

## Scope

In `runTurn`, build one `AgentTrace` while the loop runs (not by parsing history afterwards) and `rememberTrace` it from the existing `finally`, before or after the info log.

Import `EndedBy` from `trace.ts` and delete the private copy. Wrap `emit` (or intercept `run.emit`) so a `ui` event during a tool is attached to that tool and an `error` event sets `trace.error` to that message. After each `complete`, push an `AgentTraceCompletion`. After each `handleToolCall` or `skipCall`, push an `AgentTraceToolCall` onto that completion.

Completion fields:

- `allowTools` is the value passed to `llm.complete` (`true` when `toolsOff` is undefined).
- `content` is the turn's `content` (`string | null`).
- `truncated` is `true` when the turn was truncated, otherwise `false`.
- `usage` is copied from the turn when present, otherwise omitted.
- `toolCalls` lists every requested call in order, including skipped ones.

Tool outcome fields:

- `call` is the parsed `ToolCall` (same object the SSE `tool_call` event used).
- `result` is the emitted `ToolResult`.
- `skipped` is set from `result.summary` when the tool did not run: `stopped` for `"Stopped before this ran."`, `duplicate` for `"Already called with these arguments"`, `budget` for `"Tool budget used up"` (the existing `skipCall` path, including tools-off because of `max_steps` or the token cap). Omit `skipped` when the tool ran.
- `ui` is `{ id, tree }` from the last `ui` event that tool emitted, if any. Omit `ui` when there was no `ui` event (failed `render_ui`).

Trace totals match the usage log: `steps`, `toolCalls` (every requested call, including skipped), `promptTokens`, `completionTokens`, `endedBy`. Also set `conversationId` and `userText`. Omit `error` unless an `error` event was emitted (today: `"Stopped after too many steps. Try a smaller request."` when the model ignores tools-off).

The `finally` info log stays `{ conversationId, steps, toolCalls, promptTokens, completionTokens, endedBy }` with message `agent turn finished`. Do not add `userText`, tool arguments, tool results, or UI trees to that object.

A turn aborted before the first `complete` still stores a trace (`endedBy: "stopped"`, `steps: 0`, `completions: []`). History still has the user message because `runTurn` pushes it before the loop.

## Acceptance

- After `runAgent` returns, `getTraces(conversationId)` has one new trace whose `userText` is that turn's user message.
- A turn aborted before the first `complete` stores a trace with `endedBy: "stopped"`, `steps: 0`, and `completions: []`.
- A text-only reply stores one completion with `allowTools: true`, the reply `content`, and empty `toolCalls`.
- The forgotten-conversation notice emitted before `runTurn` is not a field on the trace.
- When the loop emits an `error` event, the trace has `error` set to that message; otherwise `error` is omitted.
- A successful `render_ui` has `skipped` omitted and `ui: { id, tree }` matching the SSE `ui` event.
- A failed `render_ui` (no `ui` event, for example `{ component: "Nope" }`) omits `ui`.
- Skip reasons: `stopped` when the summary is `"Stopped before this ran."`; `duplicate` when it is `"Already called with these arguments"`; `budget` when it is `"Tool budget used up"`.
- `toolCalls` on the trace counts every requested call, including skipped ones, matching the usage log's `toolCalls`.
- Parsed `args` match the SSE `tool_call` event (via `parseToolArguments`), not the raw JSON string kept in history.
- The `finally` log is still exactly `{ conversationId, steps, toolCalls, promptTokens, completionTokens, endedBy }` with message `agent turn finished`. Existing usage-log assertions in `loop.test.ts` still pass field-for-field without new payload keys.
- `run.ts`, SSE event types, and guardrail constants are unchanged.

## Validation

- `npx tsx --tsconfig ./tsconfig.server.json --test --test-concurrency=1 server/agent/loop.test.ts` exits 0. New cases cover: text-only turn; aborted-before-complete (`steps: 0`, `endedBy: "stopped"`, `completions: []`); `error` set when the model ignores tools-off; successful `render_ui` includes `ui`; invalid tree omits `ui`; duplicate skip; budget skip; stopped tool; usage-log object still field-for-field equal.
- `npx tsx --tsconfig ./tsconfig.server.json --test --test-concurrency=1 server/agent/conversations.test.ts` exits 0 (store tests still pass).
- `npm run typecheck` exits 0. The loop imports `EndedBy` from `trace.ts`; it does not declare a private copy.
