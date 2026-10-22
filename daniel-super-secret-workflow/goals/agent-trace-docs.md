---
id: agent-trace-docs
priority: 90
depends:
  - agent-trace-loop
touches:
  - docs/ARCHITECTURE.md
scope: small
---

# Document turn traces in the architecture guide

## Sources

- [Agent trace plan — Architecture docs](../plans/agent-trace.md#r6-architecture-docs)

## Context

This builds on `agent-trace-loop`, which records one `AgentTrace` per `runAgent` turn into the in-memory conversation store (`rememberTrace` / `getTraces`, last five, types in `server/agent/trace.ts`). Use the names that actually landed in code.

[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) §4 describes the chat turn and the counts-only usage log, and does not mention a stored trace. §5's data table lists conversation history and rendered designs, not traces. §8's agent line is `agent loop, conversations and their designs, tool registry, tools`.

Traces are in-memory only, last five per conversation, lost with the conversation (restart or LRU). There is no HTTP route and no client change. The usage log stays counts-only: `{ conversationId, steps, toolCalls, promptTokens, completionTokens, endedBy }` with message `agent turn finished`.

## Scope

Edit only [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md). Do not change code, SSE events, or add a traces route.

- §4 (A chat turn, end to end): say the loop stores a turn trace (completions, skip reasons, optional UI) on the conversation, and that the usage log remains counts-only.
- §5 (Data): add a row for turn traces: in-memory, last five per conversation, lost with the conversation (restart or LRU).
- §8 (Repository layout): the agent line mentions traces next to conversations and designs.

Match nearby prose. Do not invent an eval harness, a traces UI, or persistence.

## Acceptance

- §4 says the loop stores a turn trace (completions, skip reasons, optional UI) on the conversation, and that the usage log remains counts-only.
- §5 adds a row for turn traces: in-memory, last five per conversation, lost with the conversation (restart or LRU).
- §8's agent line mentions traces next to conversations and designs.

## Validation

- `grep -n -E 'turn trace|counts-only|last five' docs/ARCHITECTURE.md` prints matches in §4 and §5. The §4 chat-turn section mentions a stored turn trace (completions, skip reasons, optional UI) and a counts-only usage log. The §5 table has a turn-traces row that says in-memory, last five per conversation, and lost with the conversation.
- `grep -n 'agent/' docs/ARCHITECTURE.md` shows the §8 agent line naming traces along with conversations and designs.
- `npm run typecheck` exits 0 (docs-only change).
