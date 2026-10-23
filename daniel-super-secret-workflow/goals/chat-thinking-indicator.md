---
id: chat-thinking-indicator
priority: 30
depends: []
touches:
  - src/chatEvents.ts
  - src/chatEvents.test.ts
  - src/main.ts
  - docs/ARCHITECTURE.md
scope: medium
---

# Hide step lines in the chat and show a thinking animation

## Sources

- [Simpler chat plan — R4 The chat hides internal steps](../plans/plain-chat-and-new-chat.md#r4-the-chat-hides-internal-steps)
- [Simpler chat plan — R5 A thinking animation while the agent works](../plans/plain-chat-and-new-chat.md#r5-a-thinking-animation-while-the-agent-works)
- [Simpler chat plan — Interfaces](../plans/plain-chat-and-new-chat.md#interfaces)
- [Simpler chat plan — Errors and edge cases](../plans/plain-chat-and-new-chat.md#errors-and-edge-cases)

## Context

The chat pane (`src/main.ts`, plain DOM, Tailwind) shows developer detail to
non-technical people. `renderEvent(event, view)` appends:

- a monospace `toolLineClass` line `→ <name>` for each `tool_call`;
- `✓ <name>: <summary>` (or red `✗ …` with `errorLineClass`) for each
  `tool_result`, so a `render_ui` the agent fixes on its own looks like an
  error;
- a bubble for `text` (`assistantTurnClass`, an `<article>`), opening a new
  bubble when `view.bubble !== thread.lastElementChild`;
- `systemLineClass` lines for `notice` and `errorLineClass` lines for `error`;
- for `ui`: `renderUi(event.tree, sandbox)`, `shownUiId = event.id`,
  `showStatus(null)`, `syncActionButtons()`.

`postAction` shows an action's result in the sandbox status area with
`showStatus(result)` (only when `shownUiId === request.uiId`), then always
appends a `⚡ <action>: <message>` chat line. `askConfirm`'s Cancel appends
`⚡ <action>: cancelled`. `sendTurn(message)` sets `activeTurn`, appends the
person's message, and calls `streamChat`, ignoring events after abort; its
`finally` clears `activeTurn` and calls `setStreaming(false)`. The submit
handler's Stop path aborts `activeTurn` and appends "Stopped.".

`AgentEvent` (`shared/api.ts`) is `text`, `tool_call`, `tool_result`, `ui`,
`notice`, `done`, `error`; it does not change. `npm test` runs
`src/**/*.test.ts` under Node with no DOM (see `src/sse.test.ts`), so pure
modules are testable and `src/main.ts` is not. Turn traces in `genui_traces`
still record every tool call, so hiding the lines loses no debugging data.

A later goal, `new-chat-button`, builds on this one: it removes the thinking
indicator when the person starts a new chat and relies on the `⚡` lines
already being gone. Keep the indicator's show/hide in small helpers in
`src/main.ts` it can call.

## Scope

New pure module `src/chatEvents.ts` (no DOM):

```ts
import type { AgentEvent } from "shared/api";

/** What an event adds to the thread; null for events the person doesn't see there. */
export type ThreadEffect = "text" | "notice" | "error" | null;

/** text → "text", notice → "notice", error → "error"; tool_call, tool_result, ui, done → null. */
export function threadEffect(event: AgentEvent): ThreadEffect;

/**
 * Whether the thinking indicator shows after `event`, given whether it showed before.
 * text → false; tool_call → true; done, error → false; tool_result, ui, notice → unchanged.
 */
export function thinkingAfter(thinking: boolean, event: AgentEvent): boolean;
```

In `src/main.ts`:

- `renderEvent` uses `threadEffect` so `tool_call` and `tool_result` add
  nothing to the thread; `ui` still draws the design and clears the status
  area as today. Drop `toolLineClass` if nothing uses it.
- `postAction` no longer appends the `⚡` line, and `askConfirm`'s Cancel no
  longer appends `⚡ … cancelled`; results stay in the status area.
- A thinking indicator: three dots in a grey assistant-style bubble (same
  look as `assistantTurnClass`), animated with Tailwind classes (for example
  `animate-bounce` or `animate-pulse` with staggered delays), with
  `motion-reduce:animate-none` so it is still under
  `prefers-reduced-motion`, and announced to screen readers as "Thinking…"
  once (for example an `sr-only` "Thinking…" text with the dots
  `aria-hidden`). Built with `createElement` and `textContent` only: no
  `innerHTML`, no event data in it, no new dependency.
- `sendTurn` shows the indicator right after the person's message, before
  calling `streamChat`; after each event it applies `thinkingAfter`; its
  `finally` removes it. Stop removes it and still adds "Stopped.".
- The indicator is always the last item in the thread: a notice or error is
  inserted before it while it shows. Bubble continuation compares against the
  last visible item, ignoring the indicator: text that resumes after tool
  calls continues the current bubble when nothing visible was added in
  between, and opens a new bubble after a notice or error.

Out of scope: a developer toggle to show steps, rewording notices, errors or
action messages, the empty session menu, and the New chat button.

## Acceptance

- A turn that calls tools shows only the person's message, agent text
  bubbles, notices and errors; no `→`, `✓` or `✗` lines.
- Text resuming after tool calls continues the current bubble when nothing
  visible came in between, and opens a new bubble after a notice or error.
- Clicking an action button shows its result (success, failure, "This design
  has a hidden field, so the action was not sent.", or a confirm question) in
  the status area only; no chat line is added, and Cancel on a confirm
  question adds nothing.
- `ui` events still draw the design and clear the status area.
- Sending a message shows the indicator right after the person's message,
  before any event arrives.
- The first `text` event removes it; a later `tool_call` in the same turn
  shows it again below the text; the next `text` removes it again.
- `done`, `error`, the end of the stream and Stop remove it; at most one
  indicator is ever in the thread.
- The indicator is three dots in a grey assistant-style bubble, animated, not
  moving under `prefers-reduced-motion`, and read once as "Thinking…" by
  screen readers.
- `src/chatEvents.test.ts` covers `threadEffect` for every `AgentEvent` type
  and `thinkingAfter` from both states for every event type, including the
  sequence text → tool_call → text.
- `docs/ARCHITECTURE.md` §2 describes the chat pane without tool or `⚡`
  lines, with the thinking indicator, and the action clicks bullet no longer
  mentions chat lines; the §2 diagram no longer says "action result lines".

## Validation

- `npm run typecheck` succeeds.
- `npm test` passes, including `src/chatEvents.test.ts` (written by this goal).
- `npm run build` succeeds (the web bundle includes the new Tailwind classes).
- `npm run dev` in the worktree, which has no `.env.local` and so no OpenAI
  key (the API also starts without Postgres in development), then a browser
  at http://localhost:5173: sending a message shows the thinking indicator,
  then the "The agent is not configured…" error with the indicator gone and
  no step lines.

## After merge

- In a real chat, by eye: the thinking dots animate during a multi-tool turn and no step lines appear.
- In a real chat, by eye: clicking an action button shows its result only in the status area above the design.
