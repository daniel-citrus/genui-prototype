---
id: chat-pane-streaming
priority: 60
depends:
  - api-foundation
touches:
  - src/main.ts
  - src/agentClient.ts
  - src/sse.ts
  - src/sse.test.ts
scope: medium
---

# Send chat prompts to the agent API and stream replies

## Sources

- [Agent API plan — Step 3, Connect the chat pane](../../docs/plans/agent-api-and-database.md#6-step-3--connect-the-chat-pane)

## Context

`src/main.ts` renders a two-column shell: the chat on the left (an empty `#session-select`, a `.thread` log, and a `.composer` form with a textarea and Send button) and an empty sandbox on the right. Today, submitting only appends a user bubble (`userTurnClass`). Enter sends, and Shift+Enter inserts a newline. Styling is Tailwind utility classes in TypeScript template strings.

`api-foundation` has already added:

- `shared/api.ts`, which `src` imports through the `shared/*` path alias (set in `tsconfig.app.json` and `vite.config.ts`):
  - `AgentChatRequest { conversationId; message; resume? }`.
  - `AgentEvent`: `text {text}`, `tool_call {call}`, `tool_result {call, result: {ok, summary}}`, `notice {message}`, `done`, `error {message}`.
- A Vite proxy from `/api` to the API (`http://localhost:3001` by default).
- `npm test`, which runs `src/**/*.test.ts` under `tsx --test`. Those files are type-checked by `tsconfig.server.json` (Node types, no DOM) and excluded from `tsconfig.app.json`. Keep test-covered modules free of DOM types.

The API's `POST /api/agent/chat` takes `AgentChatRequest` JSON and answers with an SSE stream: one `data: <AgentEvent JSON>` line per event, events separated by a blank line, ending with `done` or `error`. Closing the response aborts the turn on the server. It may answer 400 (`{ error: { message } }`) for a bad request. That route comes from a parallel goal and is wired in later, so this goal must work against that contract without a running API.

## Scope

1. **`src/sse.ts`**, pure, with no DOM: `createSseParser()` returns `{ push(chunk: string): AgentEvent[] }`.
   - Buffer partial input across chunks, and split events on blank lines (handle `\n\n` and `\r\n\r\n`).
   - Join an event's `data:` lines and `JSON.parse` the result.
   - Ignore comment lines (`:`), non-`data` fields, and blocks that fail to parse.
2. **`src/agentClient.ts`:** `streamChat(req: AgentChatRequest, onEvent: (e: AgentEvent) => void, signal: AbortSignal): Promise<void>`.
   - `fetch("/api/agent/chat", { method: "POST", headers: { "content-type": "application/json" }, body, signal })`.
   - On a non-OK response, emit one `error` event using the body's `error.message` when present, otherwise `Request failed (<status>)`.
   - Read `response.body` with a `TextDecoder` (in `stream` mode) into the parser, and emit each event.
   - When `fetch` itself rejects for a reason other than abort, emit `error` with "Couldn't reach the agent service."
   - An abort resolves quietly.
3. **`src/main.ts`:**
   - Create one `conversationId = crypto.randomUUID()` per page load.
   - On submit: append the user bubble as today, then an empty assistant bubble (left-aligned, neutral zinc colors, the counterpart of `userTurnClass`). `text` events append to that bubble with `textContent +=`, never `innerHTML`.
   - `notice` and `error` render as small, muted system lines in the thread. Errors are visually distinct.
   - `tool_call` and `tool_result` render as one compact line each (the tool name, then the result `summary`).
   - Remove the assistant bubble if it is still empty when the turn ends.
   - Keep the thread scrolled to the bottom as content arrives.
   - While a turn streams, the submit button reads **Stop**. Clicking it aborts the `AbortController` and adds a "Stopped." system line. Enter does not start a second turn while one is streaming. When the turn ends (`done`, `error`, or abort), the button goes back to **Send**.
   - The session dropdown and sandbox stay as they are.

## Acceptance

- Sending a prompt posts `{ conversationId, message }` to `/api/agent/chat`, with the same `conversationId` for every prompt until the page reloads.
- Streamed `text` events appear progressively in a single assistant bubble. `notice`, `error`, `tool_call`, and `tool_result` events appear as system lines. Model text is never interpreted as HTML.
- A non-OK response, or an unreachable API, shows an error line and returns the button to Send.
- Stop aborts the in-flight request, which closes the stream so the server can stop the turn. The UI shows "Stopped." and returns to Send.
- `createSseParser` returns the correct events for chunks split mid-line or mid-JSON, for several events in one chunk, for CRLF separators, and for ignored comment or malformed blocks.

## Validation

- `npm test`: `src/sse.test.ts` (introduced by this goal) passes, covering the parser cases listed under Acceptance.
- `npm run typecheck` and `npm run build` exit 0.
- Manual, with only `npm run dev:web` running (no API): send a prompt. The Vite proxy fails, an error line appears, and the button returns to Send.
- The end-to-end browser check against the real API is part of `wire-api-services`.
