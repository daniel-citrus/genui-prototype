---
id: traces-port
priority: 10
depends: []
touches:
  - server/ports/TraceRepository.ts
  - server/ports/fakes/InMemoryTraceRepository.ts
  - server/ports/fakes/InMemoryTraceRepository.test.ts
scope: small
---

# Add a TraceRepository port and in-memory fake

## Sources

- [Trace db plan — R2](../plans/trace-db.md#r2-last-five-traces-per-conversation-durable)
- [Trace db plan — R3](../plans/trace-db.md#r3-loop-writes-traces-through-the-port)
- [Trace db plan — traces-port](../plans/trace-db.md#work-breakdown)

## Context

Finished chat turns already build an `AgentTrace` in `server/agent/trace.ts`. Today `server/agent/loop.ts` stores that object in process memory via `rememberTrace` in `server/agent/conversations.ts` (`MAX_TRACES_PER_CONVERSATION = 5` on the conversation entry). Later goals move that storage behind a port: a Drizzle adapter in Postgres database `genui_traces`, and the agent loop calling `save` instead of `rememberTrace`.

This goal only introduces the port and a fake that matches the cap and order. Do not change the loop, conversations, health, config, or Compose. Leave `MAX_TRACES_PER_CONVERSATION` on conversations until `traces-loop` removes in-memory traces; export the same constant from the new port so later goals import it from here.

`AgentTrace` (from `server/agent/trace.ts`) includes `conversationId`, `userText`, `endedBy`, `steps`, `toolCalls`, `promptTokens`, `completionTokens`, `completions`, and optional `error`. Follow the existing port style in `server/ports/CustomComponentRepository.ts` and `server/ports/fakes/InMemoryCustomComponentRepository.ts` (class implementing the interface; tests next to the fake).

## Scope

Add:

```ts
export const MAX_TRACES_PER_CONVERSATION = 5;

export interface TraceRepository {
  save(trace: AgentTrace): Promise<void>;
  listByConversation(conversationId: string): Promise<AgentTrace[]>;
}
```

- `server/ports/TraceRepository.ts`: the constant and interface. Import `AgentTrace` as a type from `../agent/trace`.
- `server/ports/fakes/InMemoryTraceRepository.ts`: process-memory implementation for tests. `save` appends then drops oldest rows for that `conversationId` past the cap. `listByConversation` returns at most five traces for that id, oldest first, or `[]` if none. Do not share lists across conversation ids. Do not import catalog or conversation modules.
- `server/ports/fakes/InMemoryTraceRepository.test.ts`: cover cap, order, isolation, and empty list. Build small `AgentTrace` fixtures (the conversations tests already show a minimal one).

Do not add HTTP, Drizzle, or loop wiring.

## Acceptance

- `MAX_TRACES_PER_CONVERSATION` exported from `server/ports/TraceRepository.ts` is `5`.
- `save` then `listByConversation` returns the saved traces for that conversation id, oldest first.
- A sixth `save` for one conversation leaves five traces; the oldest `userText` is gone.
- `listByConversation` for an unknown id returns `[]` and does not create a conversation elsewhere.
- Saves for conversation A never appear in `listByConversation` for conversation B.
- No production file other than the new port/fake imports the new symbols yet.

## Validation

- `npx tsx --tsconfig ./tsconfig.server.json --test --test-concurrency=1 server/ports/fakes/InMemoryTraceRepository.test.ts` exits 0 (this file is new).
- `npm test` exits 0; existing loop and conversation tests still use `getTraces` / `rememberTrace`.
- `npm run typecheck` exits 0.
