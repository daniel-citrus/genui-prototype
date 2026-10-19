---
id: design-memory
priority: 30
depends:
  - action-registry
touches:
  - server/agent/conversations.ts
  - server/agent/conversations.test.ts
  - server/agent/run.ts
  - server/agent/run.test.ts
  - server/agent/loop.test.ts
  - server/routes/agent.ts
scope: small
---

# Remember the last five designs sent to each conversation

## Sources

- [Interactive UI actions plan — R6 Designs remembered by id](../plans/interactive-ui-actions.md#r6-designs-remembered-by-id)
- [Interactive UI actions plan — Interfaces](../plans/interactive-ui-actions.md#interfaces)
- [Interactive UI actions plan — Errors and edge cases](../plans/interactive-ui-actions.md#errors-and-edge-cases)

## Context

The overall feature lets a Button in a rendered design run a backend action.
The browser sends the `id` of the `ui` event that drew the design. The server
checks the click against that exact tree, which it must therefore remember.
After the person presses Stop, the browser drops every later event, so it can
show an older design than the newest one the server sent. That is why the
server keeps several designs, not just the latest.

This builds on `action-registry`, which made the `ui` event
`{ type: "ui"; id: string; tree: UiNode }`. It also made `handleToolCall` in
`server/agent/run.ts` emit it as
`showUi: (tree) => run.emit({ type: "ui", id: randomUUID(), tree })`.
`showUi` is called only by `render_ui`, after the tree passes validation.

Current code:

- `server/agent/conversations.ts` holds an LRU
  `Map<string, HistoryMessage[]>` of at most `MAX_CONVERSATIONS` (500) entries,
  with `getHistory` (which creates the entry and evicts the least recently
  used), `hasConversation`, `resetConversation` and `oneTurnAtATime`.
  Nothing about designs is kept.
- `AgentRun` (`server/agent/run.ts`) has no conversation id.
  `runAgent(userText, conversationId, run, llm)` in `server/agent/loop.ts`
  receives one.
- `server/routes/agent.ts` builds the `AgentRun` for `POST /api/agent/chat`.
  `server/agent/run.test.ts` and `server/agent/loop.test.ts` also build
  `AgentRun` objects.

## Scope

- In `server/agent/conversations.ts`, store a per-conversation entry
  `{ history, designs }` and export the following. `getHistory`,
  `hasConversation`, `resetConversation` and `oneTurnAtATime` keep their
  signatures and behavior.

  ```ts
  export const MAX_DESIGNS_PER_CONVERSATION = 5;
  export function rememberDesign(conversationId: string, id: string, tree: UiNode): void;
  export function getDesign(conversationId: string, id: string): UiNode | undefined;
  ```

  `rememberDesign` on a conversation the store doesn't hold creates its entry,
  under the same LRU rules as `getHistory`. `getDesign` is a read: it doesn't
  change LRU order or create an entry.
- `AgentRun` gains `conversationId: string`. The chat route sets it, and test
  helpers set it too.
- `handleToolCall`'s `showUi` becomes
  `(tree) => { const id = randomUUID(); rememberDesign(run.conversationId, id, tree); run.emit({ type: "ui", id, tree }); }`.

## Acceptance

- `getDesign(conversationId, uiId)` returns the tree for any of the
  conversation's last five remembered designs.
- `getDesign` returns `undefined` for the following:
  - older designs (the sixth evicts the oldest)
  - unknown ids
  - unknown conversations
- A conversation's designs are dropped together with its history: when LRU
  evicts it, and on `resetConversation`.
- Only trees that passed `render_ui` are remembered (they are the only ones
  emitted). Each `ui` event's `id` is the key `getDesign` finds it under.
- The chat route behaves as before for clients. Existing tests in
  `server/routes/agent.test.ts` still pass unchanged.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including:
  - New cases in `server/agent/conversations.test.ts`: five kept, a sixth
    evicts the oldest, unknown ids and conversations return `undefined`, and
    designs are dropped with the conversation (reset and LRU eviction).
  - A new case in `server/agent/loop.test.ts`: a scripted `render_ui` call
    emits a `ui` event whose `id` `getDesign` returns for that conversation.
- `npm run build:api` succeeds.
