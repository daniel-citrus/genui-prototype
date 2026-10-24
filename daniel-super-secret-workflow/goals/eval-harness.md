---
id: eval-harness
priority: 30
depends:
  - generator
touches:
  - server/eval/runner.ts
  - server/eval/runner.test.ts
  - server/eval/checks.ts
  - server/eval/checks.test.ts
  - server/eval/types.ts
  - server/eval/loadCases.ts
  - server/eval/loadCases.test.ts
  - server/eval/cli.ts
  - server/eval/cli.test.ts
  - server/eval/writeLog.ts
  - server/eval/writeLog.test.ts
  - server/eval/cases
scope: large
---

# Rebuild the eval harness around the generator

## Sources

- [Simplify genui plan — R12, R13](../plans/simplify-to-generator-tool.md#r12-eval-harness-scores-the-generator)

## Context

This builds on `generator`, which provides `generateComponent(prompt, deps)` returning `Generation = { ok: true, tree, notes, attempts } | { ok: false, problems, attempts }` where each `GenerationAttempt` is `{ content, truncated, usage?, tree?, problems }`, plus `createOpenAIComponentLlm` and `MAX_PROMPT_CHARS` in `shared/generate.ts`.

Today `server/eval/runner.ts` runs `runAgent` with in-memory catalog, custom-component, trace and menu ports and reads the last `AgentTrace` back; `server/eval/checks.ts` scores the trace (`endedBy`, `noError`, `toolCalled`, `toolNotCalled`, `toolSucceeded`, `definedWithKey`, `replyMaxWords`, `replyExcludes`, plus tree checks `uiComponent`, `noUiComponent`, `uiButtonAction`, `noButtonAction`, `uiNamedInput`, `uiText`, `uiMarkupTag`, `agentComponent`); `server/eval/loadCases.ts` validates case files against `MAX_MESSAGE_CHARS`; `server/eval/cli.ts` handles `--repeat` (1 to 10), a 180-second timeout per case and the `pass`, `fail`, `rate`, `logs` lines; `writeLog.ts` writes logs. There are 27 cases in `server/eval/cases/`. The old agent code stays in place (a later goal removes it); this goal must not import from `server/agent/` in the eval code.

## Scope

- `runEvalCase(evalCase, { llm, signal })` seeds the case's `customComponents` into an in-memory repository (validated as today), builds the eval action registry over a fresh demo menu, calls `generateComponent` with the in-memory catalog, and returns `{ id, ok, failures, generation?, error? }`.
- A case whose generation returns `ok: false` fails with `generation failed: <n> problems`; one that rejects fails with `generation error: <error name>`.
- Check types become exactly: `maxAttempts`, `uiComponent`, `noUiComponent`, `uiButtonAction`, `noButtonAction`, `uiNamedInput`, `uiText`, `uiMarkupTag`, `agentComponent`, `notesMaxWords`, `notesExcludes`. `agentComponent` reads the model's own tree from the final attempt.
- `loadCases` refuses cases using removed check types (`endedBy`, `noError`, `toolCalled`, `toolNotCalled`, `toolSucceeded`, `definedWithKey`, `replyMaxWords`, `replyExcludes`) and prompts over `MAX_PROMPT_CHARS`.
- CLI keeps `--repeat` (1 to 10), the 180-second per-case timeout, the `pass`, `fail`, `rate`, `logs` lines and exit code 1 on any failure. A `fail` line adds `attempts: <n>`. Before `logs` it prints `first-try <runs that passed on attempt 1>/<runs>`.
- Log files hold `{ id, prompt, checks, ok, failures, attempts, tree?, notes?, error? }`; `attempts` is the list of attempts each with raw content, truncation, usage and problems.
- Case migration:
  - Remove `custom-props-shown`, `define-and-use-custom`, `delete-custom`, `off-topic-refusal`, `price-tag`.
  - `framed-note` seeds `FramedNote` with a `{$children: true}` slot and checks `agentComponent` `FramedNote`, `uiText` `Pinned`.
  - `reusable-name-list` seeds `NameList` with `$each` and checks `agentComponent` `NameList`, `uiText` `Cy`.
  - `markup-bold-tag` prompt "Draw the word SALE in a b tag inside a span", checks `uiMarkupTag` `strong`, `uiText` `SALE`.
  - `markup-prop-text` is renamed `status-dot`: "Show a small green status dot with the label Online", checks `uiMarkupTag` `circle`, `uiText` `Online`.
  - All other cases drop tool and `endedBy` checks and keep tree checks; `mockup-no-action` gains `noButtonAction`; `closed-alert` gains `noUiComponent` `Button`; `plain-short-reply` and `simple-heading` use `notesMaxWords` 40; `plain-short-reply` uses `notesExcludes` for `props`, `Stack`, `JSON`.
- `npm run eval` must wire the real OpenAI adapter (`OPENAI_API_KEY`, `AGENT_MODEL`).

## Acceptance

- 22 cases remain and `server/eval/loadCases.test.ts` loads every committed case without error.
- Removed check types are refused by `loadCases`; each new check type has pass and fail coverage.
- With a scripted fake `ComponentLlm`, `runEvalCase` returns ok for a passing design and the exact failure strings above for failed or rejected generation.
- The CLI output and log file shape match the lines and fields above, including `first-try` and `attempts: <n>`.
- Nothing under `server/eval/` imports `server/agent/`.

## Validation

- `npm run typecheck`, `npm test`, `npm run build`, `npm run build:api` pass.
- Rewritten tests introduced by this goal: `server/eval/runner.test.ts`, `checks.test.ts`, `cli.test.ts`, `writeLog.test.ts`, `loadCases.test.ts`, all with a fake LLM (no network).

## After merge

- Run `npm run eval -- --repeat 3` with `OPENAI_API_KEY` and compare with a run on `main`; expect at least the same pass rate on the cases both share, and record the `first-try` ratio.
