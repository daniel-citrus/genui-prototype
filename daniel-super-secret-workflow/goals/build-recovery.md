---
id: build-recovery
priority: 50
depends:
  - retry-after-fix
  - markup-in-designs
  - template-each
touches:
  - shared/api.ts
  - server/ports/AgentLlm.ts
  - server/agent/run.ts
  - server/agent/run.test.ts
  - server/agent/registry.ts
  - server/agent/registry.test.ts
  - server/agent/tools/ui.ts
  - server/agent/tools/ui.test.ts
  - server/agent/tools/customComponents.ts
  - server/agent/tools/customComponents.test.ts
  - server/agent/loop.ts
  - server/agent/loop.test.ts
  - server/agent/trace.ts
  - server/eval/loadCases.ts
  - server/eval/loadCases.test.ts
  - docs/ARCHITECTURE.md
scope: medium
---

# Remind the agent once to fix a failed build before ending the turn

## Sources

- [Component generation plan — R13 One repair reminder before ending unfinished](../plans/data-driven-components-and-card-forms.md#r13-one-repair-reminder-before-ending-unfinished)
- [Component generation plan — Errors and edge cases](../plans/data-driven-components-and-card-forms.md#errors-and-edge-cases)
- [Merged plan — Make validation recovery bounded and explicit](../abandoned/custom-component-decision-flow.md#4-make-validation-recovery-bounded-and-explicit)

## Context

Any model completion without tool calls ends the turn, even right after a
failed `render_ui` or `define_component`. In a real trace, one completion
said "I'll add this for each item and try again" and the turn ended with
nothing new shown. Recovery depends entirely on the prompt today.

This builds on three earlier goals: `retry-after-fix` (the loop's `seen` /
`written` duplicate rules and `ToolRegistry.writes`), `markup-in-designs`
(the current `ownTreeProblems` in `server/agent/tools/ui.ts`) and
`template-each` (the current `define_component` in
`server/agent/tools/customComponents.ts`).

Current code:

- `shared/api.ts`: `ToolResult` is `{ ok, summary, data? }`; `AgentEvent`
  includes `{ type: "text"; text }` and `{ type: "notice"; message }`.
- `server/agent/loop.ts` `runTurn`: each completion is requested with
  `onText: (text) => run.emit({ type: "text", text })`, so text streams to the
  chat as it arrives. A completion with no tool calls sets `endedBy = "reply"`
  and returns. `toolsOff` is computed per step (tool budget, token budget, or
  last step), and the turn trace is saved in `finally`.
- `server/agent/run.ts` `handleToolCall` returns `ToolOutcome`
  `{ content, isError }`.
- `server/agent/registry.ts` answers schema failures with
  `{ ok: false, summary: "Invalid arguments for <tool>", data: { errors } }`,
  unknown tools with "Unknown tool: <name>", and turns a throwing handler into
  an `ok: false` result.
- `render_ui` (`server/agent/tools/ui.ts`) reports "UI has N problems";
  `define_component` reports "Definition has N problems", "Custom components
  are unavailable", and `CustomComponentError` refusals.
- `server/ports/AgentLlm.ts` `HistoryMessage` has `user`, `assistant` and
  `tool` roles. `server/adapters/openai/OpenAILlm.ts` passes history straight
  through as `ChatCompletionMessageParam[]` after its own system prompt, so a
  `system` history message needs no adapter change. The configured model
  (`gpt-4.1`) accepts mid-conversation system messages.
- `server/agent/trace.ts`: `EndedBy` is
  `reply | max_steps | tool_budget | token_budget | stopped`; traces are
  stored as a JSON payload (`agent_traces.payload`), so new fields need no
  migration. `server/eval/loadCases.ts` lists the same values in `ENDED_BY`.

The `eval-reply-checks` and `need-based-evals` goals also edit
`server/eval/loadCases.ts`; only add `unresolved` to `ENDED_BY` there. The
`chat-thinking-indicator` goal (plain chat plan) hides step lines behind a
thinking animation in the browser, which masks the delay from held text.

## Scope

Interfaces (additive):

```ts
// shared/api.ts
export interface ToolResult { /* existing */ retryable?: true }
// server/agent/run.ts
export interface ToolOutcome { content: string; isError: boolean; retryable: boolean }
// server/ports/AgentLlm.ts
export type HistoryMessage = /* existing */ | { role: "system"; content: string };
// server/agent/trace.ts
export type EndedBy = /* existing */ | "unresolved";
export interface AgentTrace { /* existing */ repairReminders?: number }
```

New constants `REPAIR_REMINDER` and `UNFINISHED_NOTICE` in `loop.ts`. No new
endpoints, events or environment variables.

Behavior:

- Set `retryable: true` on `render_ui` "UI has N problems", `define_component`
  "Definition has N problems", and the registry's "Invalid arguments for
  {tool}". Not on "Custom components are unavailable", `CustomComponentError`
  refusals, unknown tools, or a throwing handler. `handleToolCall` returns
  `retryable` alongside `content`.
- `runTurn` tracks the latest `render_ui` and `define_component` outcome. A
  turn is *unfinished* when the latest `render_ui` call in the turn was
  retryable, or the latest `define_component` call was retryable and no
  `render_ui` has succeeded since.
- While unfinished, a completion's text is held instead of streamed. If that
  completion has tool calls, the held text is emitted (as one `text` event)
  when it ends.
- If an unfinished completion has no tool calls, the reminder hasn't been
  used, and the next completion may use tools (no `toolsOff`), the loop drops
  the held text from the chat (it stays in history), appends a system message
  `Your last {tool} call reported problems, so nothing was shown or saved. Fix them and call {tool} again now. If you need to ask the person something first, reply with only that question.`
  and continues.
- If the turn is still unfinished when the model replies with text again, or
  when no reminder is possible, the loop emits the held text, then a `notice`
  "This isn't finished: the last design still had problems.", and ends with
  `endedBy: "unresolved"`.
- At most one reminder per turn, within the existing step, tool and token
  budgets, which don't change. If the model calls a tool after the reminder
  and it fails again, the turn continues normally.
- Stop still ends the turn at once. A text reply with no unfinished build (an
  answer, a question, a successful save-only request) ends the turn as today.
- The trace records `repairReminders` (0 or 1). `ENDED_BY` in
  `server/eval/loadCases.ts` gains `unresolved`.
- Update the agent-loop and trace sections of `docs/ARCHITECTURE.md`.

## Acceptance

- `retryable` is set exactly on the three problem results listed and on no
  other result.
- A failed render followed by a text-only completion gets one reminder; the
  held text isn't emitted; a fixed render then ends the turn with `reply`.
- A reminder answered with text again emits that text, then the notice, with
  `endedBy: "unresolved"`.
- A failed define followed by a successful render ends normally, with no reminder.
- A question asked after the reminder is shown to the person.
- "Custom components are unavailable" results get no reminder.
- Stop during a held completion ends the turn at once.
- No reminder when the next step would have tools off; the turn ends with the
  held text, the notice and `unresolved`.
- `repairReminders` is on the trace, and an eval case with
  `endedBy: "unresolved"` loads.
- Turns with no failed build stream text exactly as today.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, with new tests:
  - `server/agent/loop.test.ts`: each loop case in Acceptance, with a fake model.
  - `server/agent/registry.test.ts`: invalid arguments are `retryable`;
    unknown tools and throwing handlers aren't.
  - `server/agent/run.test.ts`: `handleToolCall` passes `retryable` through.
  - `server/agent/tools/ui.test.ts` and
    `server/agent/tools/customComponents.test.ts`: `retryable` is set on
    problem results only.
  - `server/eval/loadCases.test.ts`: `endedBy: "unresolved"` is accepted.
- `npm run build` and `npm run build:api` succeed.

## After merge

- With an OpenAI key and `npm run dev`, ask for something the tools can't build (for example a bar chart with 500 bars) and check the turn ends with the "isn't finished" notice rather than a promise to retry.
