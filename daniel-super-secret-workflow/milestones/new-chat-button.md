---
id: new-chat-button
priority: 50
depends:
  - chat-thinking-indicator
  - forget-conversation-route
touches:
  - src/main.ts
  - src/agentClient.ts
  - src/agentClient.test.ts
  - docs/ARCHITECTURE.md
scope: small
---

# A New chat button that clears the session

## Sources

- [Simpler chat plan — R6 A New chat button clears the session](../plans/plain-chat-and-new-chat.md#r6-a-new-chat-button-clears-the-session)
- [Simpler chat plan — Interfaces](../plans/plain-chat-and-new-chat.md#interfaces)
- [Simpler chat plan — Errors and edge cases](../plans/plain-chat-and-new-chat.md#errors-and-edge-cases)

## Context

There is no way to start over except reloading the page. In `src/main.ts`,
`conversationId` is a `const` set once per page load with
`crypto.randomUUID()`. The chat header holds an empty `#session-select`
placeholder and the **Components** toggle (`components-toggle`, a bordered
white `rounded-lg` button with `type="button"`). `activeTurn` holds the
streaming turn's `AbortController`; the submit handler's Stop path aborts it,
clears it, calls `setStreaming(false)` and appends "Stopped.".
`renderEmpty(sandbox)` (`src/sandbox/render.ts`) shows "Designs you ask for
appear here."; `shownUiId`, `confirmShown` and `actionInFlight` track the
shown design and its status area; `showStatus(null)` clears the status area
and any confirm question. `postAction` shows a result only when
`shownUiId === request.uiId`, and only asks a confirm question when the
design is the same and no turn is active.

This goal builds on two merged goals. `chat-thinking-indicator` removed the
tool, result and `⚡` lines from the chat and added a thinking indicator
(always the last item in the thread while a turn runs) with show/hide helpers
in `src/main.ts`, driven by `src/chatEvents.ts`. `forget-conversation-route`
added `DELETE /api/agent/conversations/:conversationId`, which answers 204
(empty body) once that conversation's history and designs are gone, whether
or not it existed, and 429 past a per-IP limit.

`src/agentClient.ts` exports only `streamChat`. `npm test` runs
`src/**/*.test.ts` under Node with no DOM; `src/customComponentsClient.test.ts`
shows how to stub `globalThis.fetch` and restore it.

## Scope

`src/agentClient.ts`:

```ts
/** Asks the API to delete a conversation. Never throws; failures are ignored (the server forgets it later anyway). */
export async function forgetChat(conversationId: string): Promise<void>;
```

It sends `DELETE` with no body to `/api/agent/conversations/` +
`encodeURIComponent(conversationId)`.

`src/main.ts`: `conversationId` becomes `let`; a **New chat** button in the
chat header beside **Components** (same button styling, `type="button"`,
accessible name "New chat"); and an internal handler:

```ts
/** Stops any turn, clears the thread, composer, sandbox and status area, and starts a new conversation id. */
function startNewChat(): void;
```

It aborts and clears `activeTurn` without the "Stopped." line, removes the
thinking indicator, calls `thread.replaceChildren()`, empties and focuses the
textarea, calls `renderEmpty(sandbox)`, sets `shownUiId = null`, calls
`showStatus(null)`, calls `void forgetChat(oldId)`, sets
`conversationId = crypto.randomUUID()`, and calls `setStreaming(false)`. Make
sure `sendTurn`'s `finally` for the aborted turn cannot re-add anything or
reset state for the new chat. No confirmation dialog.

Update `docs/ARCHITECTURE.md` §2: the header diagram and bullets gain **New
chat**, and "Conversation identity" says a conversation lasts until New chat
or a reload, and that New chat deletes the old one on the server.

Out of scope: the empty session menu, a list of past chats, deleting turn
traces, and deleting a conversation on page close or reload.

## Acceptance

- The button sits in the chat header beside **Components**, with the same
  styling, `type="button"`, and accessible name "New chat".
- Clicking it while a reply streams aborts the request, adds no "Stopped."
  line, and no later event from that turn appears.
- After the click the thread is empty, the composer is empty and focused, the
  sandbox shows "Designs you ask for appear here.", the status area is empty,
  any confirm question is gone, no thinking indicator shows, and the send
  button reads "Send".
- The next message is posted with a new `conversationId`; the agent sees no
  earlier messages and no "I no longer have the earlier messages" notice
  appears.
- An action result or confirm question that comes back after the click is
  not shown.
- Saved custom components and the Components panel are untouched; an open
  panel stays open.
- The click sends `DELETE /api/agent/conversations/<old id>` without waiting
  for it: the chat is usable at once, and a failed or rate-limited delete
  shows nothing.
- Clicking it on an empty chat is harmless: it still issues a new id and
  sends the delete, answered 204.
- `forgetChat` sends `DELETE` to the encoded path with no body and resolves
  without throwing when fetch rejects or the response is 429.

## Validation

- `npm run typecheck` succeeds.
- `npm test` passes, including `src/agentClient.test.ts` (written by this
  goal, with a stubbed `globalThis.fetch`).
- `npm run build` succeeds.
- `npm run dev` in the worktree, which has no `.env.local` and so no OpenAI
  key (the API also starts without Postgres in development), then a browser
  at http://localhost:5173: send a message (the "The agent is not
  configured…" error shows), click **New chat**: the thread, composer
  and sandbox are empty, the composer is focused, and the network log shows
  `DELETE /api/agent/conversations/<old id>` answered 204; the next message is
  posted with a different `conversationId`.

## After merge

- In a real chat, by eye: New chat during a streaming reply stops it, clears everything, and the next message gets a fresh answer.
