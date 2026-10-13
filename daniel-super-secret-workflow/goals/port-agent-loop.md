---
id: port-agent-loop
priority: 40
depends:
  - api-foundation
touches:
  - server/agent/loop.ts
  - server/agent/loop.test.ts
  - server/agent/run.ts
  - server/agent/conversations.ts
  - server/agent/conversations.test.ts
  - server/routes/agent.ts
  - server/routes/agent.test.ts
scope: medium
---

# Port the agent loop and the streaming chat route

## Sources

- [Agent API plan — Step 2, Port the agent loop](../../docs/plans/agent-api-and-database.md#5-step-2--port-the-agent-loop)
- [Agent API plan — Goals and non-goals](../../docs/plans/agent-api-and-database.md#1-goals-and-non-goals)
- CapheVietPOS source at `/Users/daniel/Documents/repo/CapheVietPOS` (also `../CapheVietPOS` from this repo's root), commit `60764e5`: `server/agent/loop.ts`, `run.ts`, `conversations.ts`, `loop.test.ts`, `conversations.test.ts`, `server/routes/agent.ts` (local only)

## Context

`api-foundation` has already added these, which this goal builds on and must not change:

- `server/ports/AgentLlm.ts`: `HistoryMessage`, `LlmTurn`, `LlmUsage`, and `AgentLlm.complete({ messages, tools: ToolSpec[], signal, onText }) → Promise<LlmTurn>`.
- `server/agent/tools.ts`: `ToolSpec`, `ToolRegistry { specs; run(name, args) → Promise<ToolResult> }`, and `emptyToolRegistry`.
- `server/agent/openaiTools.ts`: `parseToolArguments(raw) → Record<string, unknown>`.
- `shared/api.ts`: `ToolCall { id, name, args }`, `ToolResult`, `AgentChatRequest { conversationId, message, resume? }`, and `AgentEvent` (`text`, `tool_call`, `tool_result`, `notice`, `done`, `error`).
- The `npm test` script runs `tsx --test` over `server/**/*.test.ts`.

The CapheVietPOS loop is an OpenAI tool-use loop:

1. Push the user message to the conversation's history.
2. Call the LLM with history and tool specs, streaming text deltas as `text` events.
3. Push the assistant turn.
4. If the turn has tool calls, run each one, push a `tool` message per call, and loop.
5. Stop when a turn has no tool calls, or after `MAX_STEPS` (10), which emits an `error` event.

Conversations are kept in memory, at most 500, with least recently used dropped first. Turns on one conversation run one at a time. The source also has menu tools, permissions, Apply / Skip confirmation, tracing, auth, an offline parser, and an eval harness. **None of those come over.** The tool list starts empty (`emptyToolRegistry`), but the tool-call path stays so tools can be added later.

`server/index.ts` belongs to `wire-api-services`. Do not register the route there. Export the plugin so that goal can.

## Scope

1. **`server/agent/conversations.ts`:** port from the source, importing `HistoryMessage` from `server/ports/AgentLlm.ts`. Keep `getHistory`, `hasConversation`, `resetConversation`, `oneTurnAtATime`, and `MAX_CONVERSATIONS = 500`. Drop `conversationKey`, since there is no signed-in owner.
2. **`server/agent/run.ts`:**
   - `AgentRun { emit(event: AgentEvent): void; signal: AbortSignal; tools: ToolRegistry; resume?: boolean }`.
   - `ToolOutcome { content: string; isError: boolean }`.
   - `handleToolCall(run, call)`:
     1. Emit `tool_call`.
     2. If the signal is aborted, emit a failed `tool_result` ("Stopped before this ran.") and return the source's stopped message.
     3. Otherwise `await run.tools.run(call.name, call.args)`, emit `tool_result`, and return `{ content: JSON.stringify({ summary, data }), isError: !ok }`.
   - Remove `can`, `permissionRefusal`, `precheck`, `confirm`, and every `MenuToolbox` reference.
3. **`server/agent/loop.ts`:**
   - Keep `MAX_STEPS = 10`, `FORGOTTEN_NOTICE`, and the `runTurn` structure, including the tool-call branch. Build each `ToolCall` from `parseToolArguments`.
   - Export `SYSTEM_PROMPT` as a short placeholder: an assistant that helps design and describe UI components, keeps replies brief, and says when it cannot do something. The loop does not send it. `wire-api-services` passes it to the OpenAI adapter's `systemPrompt` option.
   - Export `runAgent(userText, conversationId, run: AgentRun, llm: AgentLlm): Promise<void>`. It wraps `oneTurnAtATime` and, when `run.resume` is set and the conversation is unknown, emits the `FORGOTTEN_NOTICE` notice first.
   - Each step calls `llm.complete({ messages: history, tools: run.tools.specs, signal: run.signal, onText })`.
   - There is no module-level LLM client, and no import of `config` or the `openai` package.
4. **`server/routes/agent.ts`:** export `agentRouter`, a `FastifyPluginAsync<{ llm?: AgentLlm; tools: ToolRegistry }>` with `POST /chat`:
   - Answer 400 with `{ error: { message } }` when `conversationId` or a non-blank `message` is missing.
   - Call `reply.hijack()`, then write 200 with `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, and `Connection: keep-alive`. Each event is `data: <JSON AgentEvent>\n\n`, and nothing is written once the response has ended.
   - Abort an `AbortController` when the **response** emits `close`. Keep the source comment explaining why not `req.raw`.
   - With no `llm`: emit `{type:"error", message:"The agent is not configured: set OPENAI_API_KEY."}` and end.
   - Otherwise `await runAgent(message.trim(), conversationId, run, llm)`, then emit `done`. A thrown error becomes an `error` event, unless the turn was aborted. Always end the response.
   - Drop auth, traces, audit, `/confirm`, `/abort`, `/traces`, and the offline fallback.
5. **Tests**, using `node:test` and `node:assert/strict`:
   - `loop.test.ts`: ported with a scripted `AgentLlm`, which returns canned `LlmTurn`s in order and calls `onText` for each turn's content, and a stub `ToolRegistry`. Cover:
     - a text-only reply (`text` events, one assistant history row);
     - a tool call followed by a reply (`tool_call` and `tool_result` events, a `tool` history row with the matching `tool_call_id`, and the tool specs passed to `complete`);
     - `MAX_STEPS` exhaustion, which emits the "too many steps" `error`;
     - an abort before a tool runs, which reports stopped without calling `tools.run`;
     - the forgotten notice on `resume` with an unknown conversation.

     Drop the permission, precheck, and Apply / Skip cases.
   - `conversations.test.ts`: ported (`oneTurnAtATime` ordering), plus least-recently-used eviction past `MAX_CONVERSATIONS`.
   - `routes/agent.test.ts`: register `agentRouter` on a fresh `Fastify()` and use `app.inject`. Check the SSE body for a scripted reply (`text` events, then `done`), for no `llm` (one `error` event naming `OPENAI_API_KEY`), and for a missing `message` (400).
   - Do not port `traceReplay.test.ts`, `conversationMemory.test.ts`, `__evals__/`, or `__fixtures__/`.

## Acceptance

- `runAgent` streams `text` events for a text reply, runs requested tools through the `ToolRegistry`, feeds their results back to the model, and stops after 10 completions with an `error` event.
- Two turns on the same conversation never interleave their history writes.
- `POST /chat`, served by `agentRouter`, streams `AgentEvent` JSON as SSE and ends with `done` on success.
  - Without an `llm`, it streams a single `error` naming `OPENAI_API_KEY`.
  - Without a `message`, it returns 400.
  - Closing the response aborts the turn.
- No file in this goal imports menu, Square, Auth0, permission, trace, audit, `config`, or `openai` modules.

## Validation

- `npm test`: the loop, conversation, and route tests (all introduced by this goal) pass, along with the existing tests.
- `npm run typecheck` exits 0.
- `grep -rnE "menu|square|auth0|permission|trace|audit|from \"openai\"" server/agent server/routes/agent.ts` finds nothing outside comments.
