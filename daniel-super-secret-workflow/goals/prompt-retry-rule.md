---
id: prompt-retry-rule
priority: 50
depends: []
touches:
  - server/agent/systemPrompt.ts
  - server/agent/systemPrompt.test.ts
  - docs/ARCHITECTURE.md
scope: small
---

# Tell the model to fix reported problems in the same turn

## Sources

- [Props error recovery plan: R3](../plans/props-error-recovery.md#r3-fix-reported-problems-in-the-same-turn)

## Context

In the 2026-10-22 eval run the `price-tag` case failed. `define_component`
refused the model's guessed Markup props, and in its next completion (tools
still on) the model replied that it would "make the needed adjustments before
trying again" and ended the turn with nothing saved. A text-only reply ends
the turn (`server/agent/loop.ts`, around line 172).

That reply matched the last rule of `SYSTEM_PROMPT`
(`server/agent/systemPrompt.ts`, line 55) almost word for word:

```
- If a tool fails, say what you couldn't do instead of guessing. If you can no longer call tools in this turn, answer with what you have and say what is missing.
```

Step 6 (line 34) and the custom-component rules (line 44) already say to fix
reported problems and call again, but the failure rule reads as permission to
stop. Problems reported by `render_ui` (`UI has N problems`) and
`define_component` (`Definition has N problems`) are fixable and must not be
treated as failures.

`server/agent/systemPrompt.test.ts` asserts many prompt sentences verbatim and
checks that every snake_case word in the prompt is a registered tool name
(`render_ui` and `define_component` are registered). It does not currently
assert the line-55 sentence.

Each turn stays capped at 10 model calls and 20 tool calls
(`server/agent/guardrails.ts`), and the loop skips a repeated call with the
same arguments, so a firmer retry rule cannot loop forever.

## Scope

- Replace the line-55 bullet in `SYSTEM_PROMPT` with these two bullets, in
  this order, exactly:

  ```
  - Problems that render_ui or define_component reports are not failures: fix them and call the tool again in the same turn. Never reply that you will try again; call the tool instead.
  - If a tool fails for any other reason, say what you couldn't do instead of guessing. If you can no longer call tools in this turn, answer with what you have and say what is missing.
  ```

- No other prompt lines change.
- In `docs/ARCHITECTURE.md`, update the system prompt bullet (around line 205,
  starting "The system prompt lives in"): say that reported problems are
  fixed in the same turn and that the prompt forbids replies promising to try
  again. Do not edit the **UI trees** bullet (around line 208); the
  `props-hint` goal owns it.

## Acceptance

- `SYSTEM_PROMPT` contains both new bullets verbatim, in order, where the old
  last bullet was.
- `SYSTEM_PROMPT` no longer contains
  `If a tool fails, say what you couldn't do instead of guessing.`
- Every sentence `server/agent/systemPrompt.test.ts` already asserts is still
  present, and the snake_case and tool-name tests pass.
- `docs/ARCHITECTURE.md`'s system prompt bullet states that reported problems
  are fixed in the same turn and that replies promising to try again are
  forbidden.

## Validation

- `npm run typecheck` passes.
- `npm test` passes. This goal adds a test to
  `server/agent/systemPrompt.test.ts` asserting both new bullets' sentences
  and the absence of
  `If a tool fails, say what you couldn't do instead of guessing.`
- `npm run build` and `npm run build:api` succeed.

## After merge

- Run `npm run eval` three times with `OPENAI_API_KEY` set (after `props-hint` also merges): `price-tag` passes each time and other cases match `eval-logs/2026-10-22T22-04-52.968Z` (`export-pdf` may still fail).
- In a `price-tag` eval log where `define_component` was refused, confirm the next completion calls a tool instead of replying.
