---
id: agent-trace-store
priority: 10
depends: []
touches:
  - server/agent/trace.ts
  - server/agent/conversations.ts
  - server/agent/conversations.test.ts
scope: small
---

# Store the last five agent turn traces

## Sources

- [Agent trace plan — Trace type](../plans/agent-trace.md#r1-trace-type)
- [Agent trace plan — Store last five traces](../plans/agent-trace.md#r2-store-last-five-traces)
- [Agent trace plan — Interfaces](../plans/agent-trace.md#interfaces)

## Context

When a chat turn goes wrong, the product has SSE events in the browser and one counts-only usage log line. Nothing on the server keeps a structured record of completions, tool outcomes, skip reasons, or UI trees after the turn ends. Tests rebuild that picture by capturing `emit` in a local array.

This goal lands the type and the in-memory store. Recording during `runAgent` is `agent-trace-loop`. Docs are `agent-trace-docs`.

Today [server/agent/conversations.ts](../../server/agent/conversations.ts) keeps an in-memory `Map` of conversations (`history`, `designs`). `MAX_CONVERSATIONS` is 500 (LRU). `MAX_DESIGNS_PER_CONVERSATION` is 5. `getHistory` and `rememberDesign` create the conversation via `useConversation`; `getDesign` does not. `rememberDesign` evicts the oldest design. `resetConversation` deletes the entry. Lost on process restart. History is not exposed over HTTP.

[server/agent/loop.ts](../../server/agent/loop.ts) has a private `EndedBy` (`reply`, `max_steps`, `tool_budget`, `token_budget`, `stopped`) used only for the usage log. Do not change the loop in this goal.

[server/ports/AgentLlm.ts](../../server/ports/AgentLlm.ts) exports `LlmUsage` (`promptTokens`, `completionTokens`). [shared/api.ts](../../shared/api.ts) exports `ToolCall` and `ToolResult`. [shared/ui.ts](../../shared/ui.ts) exports `UiNode`.

## Scope

Add `server/agent/trace.ts` with types only (no I/O). Export `EndedBy` there so a later goal can drop the loop's private copy. Keep the five values identical to the loop's current union.

Change the conversations store:

- `Conversation` gains `traces: AgentTrace[]` (oldest first). Creating a conversation initializes `traces` to `[]`.
- Export `MAX_TRACES_PER_CONVERSATION = 5` next to `MAX_DESIGNS_PER_CONVERSATION`.
- `rememberTrace(conversationId, trace)` appends (creating the conversation if needed, like `rememberDesign`) and, when the array would exceed five, removes the oldest (index 0).
- `getTraces(conversationId)` returns the traces oldest first, or `[]` if the conversation is unknown. It does not create an entry and does not count as an LRU use (same as `getDesign`: read `store.get`, do not call `useConversation`).

`resetConversation` already deletes the whole entry, which clears traces. LRU eviction already deletes the whole entry, which drops traces. No HTTP route, no `shared/api.ts` change, no change to [server/agent/loop.ts](../../server/agent/loop.ts) or [server/agent/run.ts](../../server/agent/run.ts).

Types (copy into `server/agent/trace.ts`):

```ts
import type { ToolCall, ToolResult } from "shared/api";
import type { UiNode } from "shared/ui";
import type { LlmUsage } from "../ports/AgentLlm";

export type EndedBy = "reply" | "max_steps" | "tool_budget" | "token_budget" | "stopped";

export type ToolSkipReason = "budget" | "duplicate" | "stopped";

export interface AgentTraceToolCall {
  call: ToolCall;
  result: ToolResult;
  skipped?: ToolSkipReason;
  ui?: { id: string; tree: UiNode };
}

export interface AgentTraceCompletion {
  allowTools: boolean;
  content: string | null;
  truncated: boolean;
  usage?: LlmUsage;
  toolCalls: AgentTraceToolCall[];
}

export interface AgentTrace {
  conversationId: string;
  userText: string;
  endedBy: EndedBy;
  steps: number;
  toolCalls: number;
  promptTokens: number;
  completionTokens: number;
  completions: AgentTraceCompletion[];
  error?: string;
}
```

`rememberTrace` and `getTraces` are exported from `conversations.ts`. Tests must import `EndedBy` / `AgentTrace` from `trace.ts` and construct objects as those types (no `as AgentTrace` on partial objects that would hide missing keys). Call `resetConversation` in every test so traces do not leak, matching existing design tests in [server/agent/conversations.test.ts](../../server/agent/conversations.test.ts).

## Acceptance

- `server/agent/trace.ts` exports `EndedBy`, `ToolSkipReason`, `AgentTraceToolCall`, `AgentTraceCompletion`, and `AgentTrace` with the fields above. `EndedBy` is `"reply" | "max_steps" | "tool_budget" | "token_budget" | "stopped"`.
- `MAX_TRACES_PER_CONVERSATION` is `5`, exported from `conversations.ts`.
- `getTraces` on an unknown id returns `[]` and `hasConversation` stays false.
- A conversation created only via `getHistory` has `getTraces` equal to `[]`.
- Six `rememberTrace` calls leave the last five, oldest first (the first insert is gone).
- `resetConversation` then `getTraces` is `[]`.
- Dropping a conversation under `MAX_CONVERSATIONS` drops its traces: after `rememberTrace` on the least-recent conversation and a new conversation that triggers LRU, `getTraces` on the forgotten id is `[]` and `hasConversation` is false.
- `getTraces` does not mark a conversation recently used: reading traces on an otherwise untouched conversation still leaves it eligible for LRU eviction.
- No new HTTP route lists or returns traces. `shared/api.ts` does not export trace types.

## Validation

- `npx tsx --tsconfig ./tsconfig.server.json --test --test-concurrency=1 server/agent/conversations.test.ts` exits 0. New cases cover unknown-id `getTraces`, six-insert eviction, `resetConversation`, LRU dropping traces, and `getTraces` not counting as an LRU use.
- `npm run typecheck` exits 0. A helper or inline object typed as `AgentTrace` includes every required field; tests do not use `as AgentTrace` to paper over missing keys.
