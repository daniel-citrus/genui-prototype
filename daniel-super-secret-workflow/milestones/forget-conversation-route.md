---
id: forget-conversation-route
priority: 30
depends: []
touches:
  - server/agent/conversations.ts
  - server/agent/conversations.test.ts
  - server/routes/agent.ts
  - server/routes/agent.test.ts
  - server/rateLimit.test.ts
  - docs/ARCHITECTURE.md
scope: small
---

# Delete a conversation on the server

## Sources

- [Simpler chat plan — R7 The server deletes the old conversation](../plans/plain-chat-and-new-chat.md#r7-the-server-deletes-the-old-conversation)
- [Simpler chat plan — Interfaces](../plans/plain-chat-and-new-chat.md#interfaces)
- [Simpler chat plan — Security](../plans/plain-chat-and-new-chat.md#security)

## Context

A New chat button (a later goal, `new-chat-button`) will start a fresh
conversation id and ask the API to delete the old conversation, instead of
leaving it until eviction or restart. This goal adds that API.

`server/agent/conversations.ts` keeps, in memory, each conversation's history
and its last five designs (keyed by `ui` event id), at most 500
conversations, least recently used dropped first. `getHistory` and
`rememberDesign` go through `useConversation`, which creates a missing entry,
so a turn still finishing after a plain `resetConversation(id)` (Stop leaves a
tool call running) would recreate it. `resetConversation` deletes at once and
is used only by `server/eval/runner.ts`. `oneTurnAtATime(id, turn)` already
queues a conversation's turns one after another. `hasConversation(id)` and
`getDesign(id, uiId)` read without creating.

`server/routes/agent.ts` exports `agentRouter`, registered under `/api/agent`
in `server/app.ts`, with one route, `POST /chat`, rate-limited per IP with
`config: { rateLimit: {} }` (`server/rateLimit.ts`; each limited route is
counted separately; past the limit it answers 429 "Too many messages. Try
again in N seconds."). Route tests in `server/routes/agent.test.ts` build a
bare Fastify app with `agentRouter` and a scripted `AgentLlm`, and call
`app.inject`. `server/rateLimit.test.ts` builds the full app with `buildApp`
and a small `max`. The action route (`server/routes/actions.ts`) answers 409
"This design is no longer available. Ask the agent to show it again." when
`getDesign` misses. The Vite dev proxy and `nginx.conf` already forward every
method under `/api`.

## Scope

`server/agent/conversations.ts`:

```ts
/** Deletes a conversation's history and designs once any turn queued on it has ended. */
export function forgetConversation(conversationId: string): Promise<void>;
```

Implemented as `oneTurnAtATime(conversationId, async () =>
resetConversation(conversationId))`, so a finishing turn's last
`rememberDesign` happens before the delete.

`DELETE /api/agent/conversations/:conversationId` in `server/routes/agent.ts`:

| | |
|---|---|
| Request | Path parameter `conversationId` (1 to 100 characters; Fastify's default `maxParamLength` answers 404 past 100). No body; reads none. |
| Response | 204, empty body, after `forgetConversation` resolves, whether or not the conversation existed. |
| Errors | 429 "Too many messages. Try again in N seconds." past the per-IP limit (`config: { rateLimit: {} }`, counted separately from chat); 404 for a missing or over-long id (no route match). |
| Logs | One info line: `{ conversationId }`, "conversation forgotten". Never history or designs. |

Update `docs/ARCHITECTURE.md`: §3 routes (the new route), §5 data table
(conversation history and designs also end when deleted by this route), and
§10 (the unauthenticated delete: anyone who knows a conversation id can wipe
its history, the same trust the action route relies on; ids are random UUIDs
known only to the browser that made them).

No change to `AgentEvent`, `AgentChatRequest`, config or environment
variables. Saved turn traces in `genui_traces` are not deleted.

## Acceptance

- `DELETE /api/agent/conversations/<id>` answers 204 with an empty body for a
  known id and for an unknown id.
- After it answers, `hasConversation(id)` is false, `getDesign(id, uiId)` is
  undefined for every design the conversation had, and a following
  `POST /api/agent/chat` on the same id sends the model only the new message.
- A turn still running on that conversation finishes first, and a design it
  remembers before ending is gone after the delete resolves.
- An action click naming a design of the deleted conversation gets the
  existing 409 "This design is no longer available…".
- Other conversations and saved turn traces are untouched.
- Past the per-IP limit the route answers 429 with the "Too many messages…"
  message, and using up its limit does not block chat.
- Each request logs one info line with the conversation id only.

## Validation

- `npm run typecheck` succeeds.
- `npm test` passes, including new tests (written by this goal) in
  `server/agent/conversations.test.ts` (`forgetConversation` removes history
  and designs, waits for a queued turn whose late `rememberDesign` does not
  survive, leaves other conversations alone), `server/routes/agent.test.ts`
  (204 for known and unknown ids, `hasConversation` false afterwards, the next
  chat on the id sends only the new message), and `server/rateLimit.test.ts`
  (through `buildApp`, 429 past the limit; chat still allowed).
- `npm run build:api` succeeds.
