---
id: turn-limits
priority: 20
depends: []
touches:
  - server/agent/guardrails.ts
  - server/agent/loop.ts
  - server/agent/loop.test.ts
  - server/agent/tools.ts
  - server/ports/AgentLlm.ts
  - server/agent/openaiTools.ts
  - server/agent/openaiTools.test.ts
  - server/adapters/openai/OpenAILlm.ts
  - server/adapters/openai/OpenAILlm.test.ts
  - server/config.ts
  - server/index.ts
  - .env.example
  - docs/ARCHITECTURE.md
scope: medium
---

# Cap each agent turn, ending in a reply instead of an error

## Sources

- [Guardrails plan — Step 3, Turn limits](./agent-guardrails.md#step-3--turn-limits)

## Context

`runTurn` in `server/agent/loop.ts` calls the model up to `MAX_STEPS` (10) times per turn. Each call is `llm.complete({ messages, tools, signal, onText })`. Every tool call the model returns runs through `handleToolCall` in `server/agent/run.ts`, and its result is pushed into the history as a `tool` message. If the 10th completion still asks for tools, the turn ends with the error event "Stopped after too many steps. Try a smaller request."

Nothing else is limited: tool calls per turn, repeated identical calls, tokens per turn, and output tokens per completion are all unbounded.

Relevant code:

- **The port:** `AgentLlm` in `server/ports/AgentLlm.ts`. `LlmTurn` has `content`, `toolCalls` and optional `usage` (`promptTokens`, `completionTokens`).
- **The adapter:** `createOpenAILlm` in `server/adapters/openai/OpenAILlm.ts` streams Chat Completions. It prepends the system prompt and omits `tools` when the list is empty. It reads usage from the final chunk and stitches tool-call fragments with `createTurnAccumulator` in `server/agent/openaiTools.ts`. The loop ignores usage today.
- **Logging:** `AgentRun.log` is a `ToolLogger` (`server/agent/tools.ts`), with `debug` and `error` only. The route passes `req.log`, which also has `info`.
- **Config:** `server/config.ts` reads the environment, and `server/index.ts` builds the adapter.
- **Tests:** `server/agent/loop.test.ts` drives the loop with a scripted model (`scriptedLlm(turns)`) and stub tools.

## Scope

**1. One file for the limits**, `server/agent/guardrails.ts`: `MAX_STEPS = 10` (moved from `loop.ts`; keep exporting it from `loop.ts` too, or update imports), `MAX_TOOL_CALLS_PER_TURN = 20`, `MAX_TURN_TOKENS = 150_000`, and `DEFAULT_MAX_OUTPUT_TOKENS = 2048`.

**2. The port and adapter:**

- `complete()` takes an optional `allowTools?: boolean` (default `true`). When `false` and tools exist, the adapter still sends `tools` but adds `tool_choice: "none"`. Removing the tool list would make the history's earlier tool calls invalid.
- `createOpenAILlm` takes `maxOutputTokens` and sends it as `max_completion_tokens`.
- `LlmTurn` gains `truncated?: boolean`, true when the stream's `finish_reason` is `"length"`. Record the finish reason in the accumulator or the adapter.

**3. The loop.** Track the turn's tool calls, a set of call keys, and its tokens (prompt plus completion, summed from each completion's `usage`; skip missing usage). Before each completion, set `allowTools = false` when any of these holds:
- it's the last allowed completion (`step === MAX_STEPS - 1`);
- the tool-call count has reached `MAX_TOOL_CALLS_PER_TURN`;
- the token sum has reached `MAX_TURN_TOKENS`.

| Situation | What happens |
|---|---|
| A tool call past the 20th in the turn | Not run. The loop emits `tool_call` and a `tool_result` with `ok: false`, "Tool budget used up". The history gets the content "Tool budget for this turn is used up; answer with what you have." |
| The same tool with the same arguments again in this turn | Not run, and still counts toward the budget. Emits `tool_call` and a `tool_result` with `ok: false`, "Already called with these arguments". The history gets "You already called `<tool>` with these arguments in this turn; use that result." |
| A completion sent with tools disabled still returns tool calls | They're answered as over-budget calls (never run), and the turn ends with the existing "Stopped after too many steps" error. This is a fallback; `tool_choice: "none"` should prevent it. |
| A completion returns `truncated: true` | Emit `{ type: "notice", message: "The reply was cut off because it was too long." }` |

- **Repeat key:** the tool name plus the arguments serialized with object keys sorted recursively.
- **History stays valid:** every assistant tool call must get exactly one `tool` message, including calls that don't run, or the next completion is rejected.
- **Usage log:** at the end of every turn, log at info level: conversation id, steps, tool calls, prompt tokens, completion tokens, and `endedBy` (`reply`, `max_steps`, `tool_budget`, `token_budget` or `stopped`). Add `info` to `ToolLogger`; `req.log` already satisfies it, and test loggers need an `info` stub.

**4. Config:** `AGENT_MAX_OUTPUT_TOKENS` in `server/config.ts`, a positive integer with default 2048 (reuse the existing `port()`-style parsing). `server/index.ts` passes it to `createOpenAILlm`. Add `# AGENT_MAX_OUTPUT_TOKENS=2048` to `.env.example`.

**5. Docs:** in `docs/ARCHITECTURE.md`, describe the turn limits (or link `server/agent/guardrails.ts`), add `AGENT_MAX_OUTPUT_TOKENS` to Configuration, and update "Current limits" and the chat-turn section where it mentions `MAX_STEPS`.

**Out of scope:** request-level limits (message size, rate), the system prompt, and new tools.

## Acceptance

Scripted-model tests in `server/agent/loop.test.ts` show:

- With a model that always asks for a tool, completions 1–9 are sent with tools allowed, and the 10th with `allowTools: false`. If that 10th completion replies with text, the turn ends with `text` and `done` and no error event.
- In one turn, the 21st tool call isn't run (the stub tool's run count stays 20). It gets `tool_call` plus an `ok: false` "Tool budget used up" result, and the next completion has tools disabled.
- A second identical call (same name and arguments, keys in a different order) isn't run, gets the "already called" result, and counts toward the 20.
- Once summed usage reaches 150,000 tokens, the next completion has tools disabled.
- A truncated completion emits the cut-off notice.
- After every scenario, each assistant tool call in the history is followed by exactly one matching `tool` message.
- One info log is written per turn, with the fields above and the right `endedBy`.

`server/adapters/openai/OpenAILlm.test.ts` shows:

- `allowTools: false` sends `tool_choice: "none"` with `tools` still present.
- `max_completion_tokens` equals the configured value.
- `finish_reason: "length"` yields `truncated: true`, and `"stop"` doesn't.

## Validation

- `npm run typecheck`, `npm test`, `npm run build` and `npm run build:api` pass.
- With `OPENAI_API_KEY` in `.env.local`, start `npm run dev` and send one chat message. The API log shows the per-turn info line. Without a key, say this check wasn't run.
