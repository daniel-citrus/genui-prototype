---
id: eval-cli
priority: 30
depends:
  - eval-runner
touches:
  - server/eval/cli.ts
  - server/eval/cli.test.ts
  - server/eval/cases/simple-heading.json
  - server/eval/cases/echo-form.json
  - package.json
scope: medium
---

# Add npm run eval and two committed live cases

## Sources

- [Eval harness plan — R4](../plans/eval-harness.md#r4-live-cli-requires-a-key)
- [Eval harness plan — R5](../plans/eval-harness.md#r5-starter-case--heading)
- [Eval harness plan — R6](../plans/eval-harness.md#r6-starter-case--echo-form)
- [Eval harness plan — Interfaces](../plans/eval-harness.md#interfaces)
- [Eval harness plan — eval-cli](../plans/eval-harness.md#work-breakdown)

## Context

This builds on `eval-runner`, which provides `runEvalCase` over in-memory ports and an injected `AgentLlm`. `eval-checks` provides `loadCases` and the case/check types. There is no `npm run eval` yet and no `server/eval/cases/`.

Production chat builds the live model in `server/index.ts` with `createOpenAILlm({ apiKey, model, maxOutputTokens, systemPrompt: SYSTEM_PROMPT })` from `server/adapters/openai/OpenAILlm.ts`, using `config.openai` in `server/config.ts` (`OPENAI_API_KEY`, `AGENT_MODEL` default `gpt-4.1`, `AGENT_MAX_OUTPUT_TOKENS`) and `SYSTEM_PROMPT` from `server/agent/systemPrompt.ts`. `agentAvailable` is true only when the trimmed key is non-empty. The CLI is the only eval entry that calls `createOpenAILlm`. The runner must keep not importing it.

`config` and `agentAvailable` are evaluated at import time from `process.env`. Tests import many server modules, so a developer's shell key can make `agentAvailable` true. Export `main` so tests can force the missing-key path (for example `main({ agentAvailable: false })`) without spawning a network client. The `npm run eval` entry uses the real `agentAvailable`.

`package.json` `dev:api` is `tsx watch --tsconfig ./tsconfig.server.json --env-file-if-exists=.env.local server/index.ts`. Follow that env-file pattern. `npm test` already globs `server/**/*.test.ts`. CI (`.github/workflows/ci.yml`) runs typecheck, test, and both builds and does not set `OPENAI_API_KEY`. Do not add `npm run eval` to CI. Do not change the agent loop, routes, system prompt, or traces adapter. Do not change `docs/ARCHITECTURE.md` or `README.md` (docs are a later goal).

`demo_echo` in `server/actions/demo.ts` has one optional string property `text`. The catalog includes `Heading`.

Workers prove the CLI with a missing key and prove the committed case files through `loadCases`. Workers do not run the cases against OpenAI.

## Scope

Add `package.json` script:

```
"eval": "tsx --tsconfig ./tsconfig.server.json --env-file-if-exists=.env.local server/eval/cli.ts"
```

Add `server/eval/cli.ts`. Export `async function main(...): Promise<number>` (or set `process.exitCode`) so tests can invoke it without `process.exit` killing the test process. The file's entry path may call `process.exit` with that code when run as the script.

When the agent is not available (empty or missing key): print that `OPENAI_API_KEY` is required, return/exit 1 or 2, and do not call `createOpenAILlm`, `loadCases` starting a turn, or `runEvalCase`. Do not print the key value.

When the agent is available: `createOpenAILlm({ apiKey: config.openai.apiKey, model: config.openai.model, maxOutputTokens: config.openai.maxOutputTokens, systemPrompt: SYSTEM_PROMPT })`, `loadCases` from `server/eval/cases`, then `runEvalCase` for each case in order. Give each case a 180-second abort (`AbortSignal.timeout(180_000)` or equivalent) passed as `opts.signal`. On abort the case fails with a reason that mentions timeout, and the next case still runs. A failed case must not stop the remaining cases. Exit 0 only when every case passed; exit 1 if any failed.

Each report line is `pass` or `fail`, the case `id`, and on fail the check reasons plus `endedBy` and `error` when present. Logs and stdout must omit `userText`, completions, tool arguments, and UI trees. Do not log the API key.

Add the two committed files exactly:

`server/eval/cases/simple-heading.json`: `id` `simple-heading`, `prompt` `Show a heading that says Hello`, `checks` `endedBy: "reply"`, `noError`, `toolSucceeded: "render_ui"`, `uiComponent: "Heading"`.

`server/eval/cases/echo-form.json`: `id` `echo-form`, `prompt` `Show a form with a text field and a button that runs the demo echo action with what I type`, `checks` `endedBy: "reply"`, `noError`, `toolCalled: "list_actions"`, `toolSucceeded: "render_ui"`, `uiButtonAction: "demo_echo"`, `uiNamedInput: "text"`.

No new environment variables. Existing names only: `OPENAI_API_KEY`, `AGENT_MODEL`, `AGENT_MAX_OUTPUT_TOKENS`.

## Acceptance

- `package.json` has `"eval"` that runs the CLI with `--env-file-if-exists=.env.local` and `server/eval/cli.ts`.
- With the key unset or empty (forced in the test), exported `main` prints that `OPENAI_API_KEY` is required and exits 1 or 2; no case starts; `createOpenAILlm` is not called.
- With a key (live, after merge), cases run one after another; each report line is `pass` or `fail`, the case `id`, and on fail the check reasons plus `endedBy` and `error` when present.
- One failed case still runs the next; process exit is 1 if any failed, 0 only when every case passed.
- A 180-second abort per case; on abort the case fails (reason mentions timeout) and the next case still runs.
- Report and fail reasons omit `userText`, completions, tool arguments, and UI trees.
- The two case files load through `loadCases` with the `id`, `prompt`, and `checks` above.
- `.github/workflows/ci.yml` still does not run `npm run eval`.

## Validation

- `npm test` includes `server/eval/cli.test.ts` (this goal adds it): exported `main` on the missing-key path (needs no API key) exits non-zero and the message includes `OPENAI_API_KEY`; that path does not start a case.
- `npm test` loads `server/eval/cases` and asserts `simple-heading` and `echo-form` match the `id`, `prompt`, and `checks` in Scope (no live model call).
- `npm run typecheck` passes.
- `npm run build` and `npm run build:api` pass.
- `grep -n "npm run eval" .github/workflows/ci.yml` prints nothing.

## After merge

- With `OPENAI_API_KEY` in `.env.local`, `npm run eval` exits 0 on `simple-heading` and `echo-form`.
- If a case fails, the printed reasons have no tree JSON and no prompt text.
- `curl -s localhost:5173/api/health` is unchanged; `genui_traces` gains no row from the eval run.
