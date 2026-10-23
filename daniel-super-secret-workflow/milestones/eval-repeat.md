---
id: eval-repeat
priority: 20
depends: []
touches:
  - server/eval/cli.ts
  - server/eval/cli.test.ts
  - server/eval/writeLog.ts
  - server/eval/writeLog.test.ts
scope: medium
---

# Run each eval case N times with --repeat and print pass rates

## Sources

- [Eval findings fixes — R7, Interfaces, Security](../plans/eval-findings-fixes.md#r7---repeat-n-on-the-eval-cli)

## Context

Eval cases run against the live model and are nondeterministic, so one run
cannot tell a flaky case from a broken one. `npm run eval -- --repeat N`
should run every case N times and print a pass rate per case.

Current code:

- `server/eval/cli.ts` exports `main(options: CliMainOptions)`. It returns 1
  with `OPENAI_API_KEY is required to run eval cases.` when the agent is
  unavailable, loads cases (`loadCases`), creates `eval-logs/<timestamp>/`
  with `createEvalLogDir`, creates the OpenAI LLM, then for each case runs
  `runEvalCase` under a fresh `timeoutSignal()` (default
  `AbortSignal.timeout(180_000)`; an aborted signal turns the result into
  `timeoutResult`), writes `<id>.json` with `writeEvalCaseLog` (a missing
  trace prints `log failed <id> missing-trace`; a write error prints
  `log failed <id> <code>`), and prints `formatResult(result)`:
  `pass <id>` or `fail <id> <reasons>`. After all cases it prints
  `logs <absolute dir>` and returns 1 if any case or log write failed. It
  reads no command-line arguments: the entry point at the bottom calls
  `main()` with no options. `CliMainOptions.inject` lets tests replace every
  dependency.
- `server/eval/writeLog.ts` `writeEvalCaseLog(dir, log)` refuses ids that
  are not kebab-case (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`), refuses a path that
  escapes `dir`, and writes `<id>.json` with flag `wx`.
- `server/eval/cli.test.ts` covers `main` with injected fakes, including
  "does not leak the OpenAI api key into logs or terminal output". It also
  holds a `committedCases` array; leave that array alone, since the
  `eval-cases-update` goal rewrites it.

## Scope

- `server/eval/cli.ts`:
  - `export function parseCliArgs(argv: string[]): { ok: true; repeat: number } | { ok: false; error: string }`,
    using `parseArgs` from `node:util` with `strict: true` and
    `options: { repeat: { type: "string" } }` (no new dependency). No
    arguments gives `repeat: 1`. The value must match `/^\d+$/` and be from 1
    to 10. A bad, out-of-range or missing value (including `--repeat`
    followed by another option) gives
    `--repeat must be a whole number from 1 to 10`; an unknown option gives
    `unknown option <name>` (for example `unknown option --other`).
    Assumption: a positional argument is also refused, with
    `unexpected argument <value>`.
  - `CliMainOptions` adds `argv?: string[]` (default `[]`). `main` parses it
    first, before the agent-availability check, and on error prints the one
    error line through `error` and returns 1 without loading cases or
    creating a log directory. The entry point passes
    `process.argv.slice(2)`.
  - With `repeat === 1`, output, file names and exit codes are exactly as
    today.
  - With `repeat > 1`, each case runs `repeat` times back to back, each
    attempt with its own `timeoutSignal()`; a timeout on one attempt does
    not stop later ones. Each attempt prints `pass <id> [k/N]` or
    `fail <id> [k/N] <reasons>` (k from 1) and is logged with
    `writeEvalCaseLog(dir, record, k)`. After all cases, print one
    `rate <id> <passes>/<N>` line per case in case order (passes = attempts
    whose result was ok), then the `logs <dir>` line. `log failed` lines keep
    their current form.
  - Exit code 1 if any attempt failed or any log write failed, otherwise 0.
- `server/eval/writeLog.ts`: `writeEvalCaseLog(dir: string, log: EvalCaseLog, attempt?: number): void`.
  Without `attempt`, it writes `<id>.json` as today. With `attempt`, it writes
  `<id>.<attempt>.json` and throws unless `attempt` is a whole number from 1
  to 10. The kebab-case and path-escape checks stay. Ids cannot contain `.`,
  so attempt files never collide with `<id>.json`.

Out of scope: a `--case <id>` filter.

## Acceptance

- `parseCliArgs([])` and `parseCliArgs(["--repeat", "1"])` give `repeat: 1`;
  `["--repeat", "3"]` and `["--repeat=3"]` give `repeat: 3`.
- `0`, `11`, `2.5`, `abc` and a missing value give
  `--repeat must be a whole number from 1 to 10`; `["--other"]` gives
  `unknown option --other`.
- `main({ argv: ["--repeat", "x"] })` prints one error line, returns 1, and
  calls neither `loadCases` nor `createEvalLogDir`.
- `main` with no `argv` behaves and prints exactly as before (existing tests
  pass unchanged).
- `main` with `argv: ["--repeat", "2"]` and two cases writes
  `<id>.1.json` and `<id>.2.json` for each case, prints `[k/2]` result
  lines, then `rate <id> <passes>/2` per case in case order, then
  `logs <dir>` last; it returns 1 when one attempt fails and 0 when all
  pass.
- `writeEvalCaseLog` with `attempt` 1 writes `<id>.1.json`; `attempt` 0, 11
  and 1.5 throw before writing.
- The OpenAI API key never appears in logs, stdout or stderr: the existing
  no-leak test is extended to run with `argv: ["--repeat", "2"]` and checks
  both attempt files.

## Validation

- `npm test`: passes, including new tests (to add) in
  `server/eval/cli.test.ts` for `parseCliArgs` (no args, `--repeat 3`,
  `--repeat=3`, `0`, `11`, `2.5`, `abc`, missing value, `--other`), `main`
  with `--repeat 2` (file names, line order, exit codes), bad args creating
  no log directory, and the no-leak test with `--repeat 2`; and in
  `server/eval/writeLog.test.ts` for attempt file names and refused attempt
  values. All use the injected fakes; no API key is needed.
- `npm run typecheck`: passes.
- `npm run build:api`: succeeds.

## After merge

- With `OPENAI_API_KEY` set, run `npm run eval -- --repeat 2` and confirm `[k/2]` lines, `rate` lines before `logs`, and `<id>.1.json`/`<id>.2.json` files in the new `eval-logs/` directory.
