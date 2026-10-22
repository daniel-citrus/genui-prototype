---
id: eval-docs
priority: 90
depends:
  - eval-cli
touches:
  - docs/ARCHITECTURE.md
  - README.md
scope: small
---

# Document npm run eval as a live-model check outside CI

## Sources

- [Eval harness plan — R7](../plans/eval-harness.md#r7-docs-mention-the-command)
- [Eval harness plan — eval-docs](../plans/eval-harness.md#work-breakdown)

## Context

This builds on `eval-cli`, which adds `npm run eval` (`tsx --tsconfig ./tsconfig.server.json --env-file-if-exists=.env.local server/eval/cli.ts`), `server/eval/` (types, loaders, checkers, runner, CLI), and two committed cases (`simple-heading`, `echo-form`). The command calls `createOpenAILlm` with `config.openai` and `SYSTEM_PROMPT` (same model as chat). It needs `OPENAI_API_KEY`. Cases score the saved `AgentTrace` with deterministic checks. The runner uses in-memory ports and does not write `genui_traces`. CI does not run it.

`docs/ARCHITECTURE.md` §8 (Repository layout) lists `server/agent/` under `server/` and has no `server/eval/`. §9 (Build, test, and CI) lists `dev`, `build`, `typecheck`, `test`, and the db scripts; it says tests use a fake model so they need no OpenAI key, and CI runs typecheck, tests, and both builds. §10 (Current limits and what's next) describes chat, traces in `genui_traces`, and planned work; it does not mention eval cases.

README "Other scripts" lists `npm test`, `typecheck`, `build`, `build:api`, `preview`, and the db scripts. It does not list `npm run eval`.

Do not change the eval implementation, CI workflow, agent loop, or traces adapter. Do not add an eval HTTP or UI.

## Scope

Update `docs/ARCHITECTURE.md`:

- §8 lists `server/eval/` next to `server/agent/` (case files, checkers, runner, CLI).
- §9 includes `npm run eval` and says it needs `OPENAI_API_KEY`, uses the same model as chat, and is not run in CI.
- §10 says two committed live cases score the turn trace (a heading; a `demo_echo` form).

Update README "Other scripts" to include `npm run eval` with the same key requirement (needs `OPENAI_API_KEY`; not part of CI).

## Acceptance

- §8 lists `server/eval/` next to `server/agent/`.
- §9 includes `npm run eval` and says it needs `OPENAI_API_KEY`, uses the same model as chat, and is not run in CI.
- §10 says two committed live cases score the turn trace (heading; `demo_echo` form).
- README "Other scripts" includes `npm run eval` with the same key requirement.
- `.github/workflows/ci.yml` still does not run `npm run eval`.

## Validation

- `grep -n "server/eval" docs/ARCHITECTURE.md` matches a line in the §8 layout (or the prose that lists it next to `server/agent/`).
- `grep -n "npm run eval" docs/ARCHITECTURE.md README.md` matches §9, the limits section, and README "Other scripts".
- Those hits (without running a live model) say the command needs the same OpenAI environment variable chat uses, uses the same model as chat, and is not run in CI; §10 names the heading case and the `demo_echo` form.
- `grep -n "npm run eval" .github/workflows/ci.yml` prints nothing.
- `npm run typecheck` passes.

## After merge

- Skim §8–§10 and README "Other scripts" to confirm the command name matches `package.json` `eval`.
