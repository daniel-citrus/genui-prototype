---
id: openai-llm-adapter
priority: 50
depends:
  - api-foundation
touches:
  - server/adapters/openai/OpenAILlm.ts
  - server/adapters/openai/OpenAILlm.test.ts
scope: small
---

# OpenAI adapter for the agent's LLM port

## Sources

- [Agent API plan — Step 5, Adapter scaffold (OpenAI)](../../docs/plans/agent-api-and-database.md#8-step-5--adapter-scaffold)
- [Agent API plan — Step 2, Port the agent loop](../../docs/plans/agent-api-and-database.md#5-step-2--port-the-agent-loop) (empty `tools` rule)
- CapheVietPOS source at `/Users/daniel/Documents/repo/CapheVietPOS` (also `../CapheVietPOS` from this repo's root), commit `60764e5`: the `createOpenAILlm` function in `server/agent/loop.ts` (local only)

## Context

The agent loop calls the LLM only through the `AgentLlm` interface that `api-foundation` added in `server/ports/AgentLlm.ts`:

```ts
interface AgentLlm {
  complete(input: {
    messages: HistoryMessage[];   // user / assistant (+tool_calls) / tool rows
    tools: ToolSpec[];            // vendor-neutral, from server/agent/tools.ts
    signal: AbortSignal;
    onText(text: string): void;
  }): Promise<LlmTurn>;           // { content, toolCalls[{id,name,arguments}], usage? }
}
```

`api-foundation` also added `server/agent/openaiTools.ts`, with `toOpenAITools(specs)` (`ToolSpec` → Chat Completions function tools) and `createTurnAccumulator()` (stitches streamed deltas into one turn). The `openai` package and `config.openai` (`apiKey`, `model` with default `gpt-4.1`) already exist.

In CapheVietPOS, `createOpenAILlm` lives in `loop.ts` and reads the system prompt, tools, and config from module scope. Here it becomes a standalone adapter that takes everything as arguments. Building it from config and passing it to the chat route is `wire-api-services`'s job, not this goal's.

## Scope

1. **`server/adapters/openai/OpenAILlm.ts`:** export `createOpenAILlm(opts): AgentLlm`, where `opts` is `{ apiKey: string; model: string; systemPrompt: string; maxRetries?: number; client?: ChatClient }`.
   - `ChatClient` is the minimal slice of the SDK used here: something with `chat.completions.create(body, { signal })` returning an async iterable of chunks. A real `OpenAI` instance satisfies it. Tests pass a fake through `client`.
   - Without `client`, create `new OpenAI({ apiKey, maxRetries })` lazily on the first `complete`, as the source does.
2. **`complete`:** port the source's streaming implementation.
   - The request is `{ model, messages: [{ role: "system", content: systemPrompt }, ...messages], stream: true, stream_options: { include_usage: true } }`, with `tools: toOpenAITools(tools)` **only when `tools` is non-empty**. The API rejects an empty `tools` array.
   - Pass `signal` in the request options.
   - For each chunk: record `usage` (`prompt_tokens` and `completion_tokens` → `promptTokens` and `completionTokens`), call `onText` for every `delta.content`, and feed every delta to the accumulator.
   - Return `{ content: finished.content || null, toolCalls, usage }`.
3. **`server/adapters/openai/OpenAILlm.test.ts`:** a fake `client` that records the request and yields scripted chunks. Cover:
   - the system prompt comes first, followed by the history in order;
   - with `tools: []`, the request has no `tools` key, and with one spec it has the converted function tool;
   - `onText` receives each content delta, and the returned `content` is their concatenation;
   - tool-call fragments split across chunks come back as one `{ id, name, arguments }`;
   - a usage-only final chunk (no `choices`) is reported as `usage`;
   - an all-tool-call turn returns `content: null`;
   - the `signal` reaches `create`.

## Acceptance

- `createOpenAILlm({ apiKey, model, systemPrompt })` returns an object that satisfies `AgentLlm` and type-checks against `server/ports/AgentLlm.ts` without changing it.
- Requests always start with the given system prompt, never include an empty `tools` array, and stream with usage included.
- Streamed text reaches `onText` as it arrives. Fragmented tool calls are reassembled. Token usage is returned when the provider reports it.
- No real network call happens in tests. The SDK client is only built when no `client` is injected, and only on first use.

## Validation

- `npm test`: the `OpenAILlm` tests (introduced by this goal) pass.
- `npm run typecheck` exits 0.
- Optional manual smoke, if an `OPENAI_API_KEY` is available: a short `tsx --tsconfig ./tsconfig.server.json -e` script calling `complete` with one user message prints streamed text and returns a non-empty `content`.
