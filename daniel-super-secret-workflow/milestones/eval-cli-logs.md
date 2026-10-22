---
id: eval-cli-logs
priority: 50
depends:
  - eval-case-trace
  - eval-log-writer
touches:
  - server/eval/cli.ts
  - server/eval/cli.test.ts
  - .gitignore
scope: medium
---

# Write a gitignored eval log directory from the CLI

## Sources

- [Eval logs plan — R3](../plans/eval-logs.md#r3-a-gitignored-directory-per-run)
- [Eval logs plan — R4](../plans/eval-logs.md#r4-terminal-stays-one-line-per-case)
- [Eval logs plan — Design](../plans/eval-logs.md#design)

## Context

This builds on `eval-case-trace`, which makes `EvalCaseResult.trace` required, sets it from the trace `runEvalCase` already scores, and copies `partial.trace` inside `timeoutResult`. It also builds on `eval-log-writer`, which provides `EvalCaseLog`, `evalLogDirName`, `createEvalLogDir`, and `writeEvalCaseLog` in `server/eval/writeLog.ts`.

`main` in `server/eval/cli.ts` returns 1 before loading cases when the agent is unavailable, with the exact stderr line `OPENAI_API_KEY is required to run eval cases.` Otherwise it calls `createOpenAILlm` (the client is constructed on the first `complete`, not in that factory), loads cases, and runs each one with `AbortSignal.timeout(180_000)`. `CASE_TIMEOUT_MS` is `180_000`. A case whose signal is already aborted is replaced by `timeoutResult`. `formatResult` prints `pass <id>` or `fail <id>` plus failure reasons, then `endedBy:` and `error:` when those fields are set. The process exits 0 only when every case passed. Tests call `main` with injected `loadCases`, `runEvalCase`, and `createOpenAILlm`. They do not spawn a process.

`.gitignore` has no eval-log line. Its entries are `node_modules`, `dist`, `*.local`, `.DS_Store`, `*.tsbuildinfo`, `.playwright-mcp`, and `server-dist/`. Chat, Postgres `genui_traces`, `package.json`, and `.github/workflows/ci.yml` stay as they are. CI does not run `npm run eval`. There is no argv flag and no log-directory environment variable.

`config.openai.apiKey` is `(env.OPENAI_API_KEY ?? "").trim()` from `server/config.ts`. Workers have no `.env` and no API key. `noopLogger` stays, so eval still does not print `agent turn finished`.

## Scope

After a successful `loadCases`, create the log directory, then call `createOpenAILlm`, then run the case loop. Today the factory is called before `loadCases`. Move it to after the directory exists so a failed create does not call it.

`CliMainOptions` gains optional fields, all defaulted so the real CLI path is unchanged:

```ts
export type CliMainOptions = {
  agentAvailable?: boolean;
  casesDir?: string;
  logRoot?: string;
  now?: () => Date;
  log?: (line: string) => void;
  error?: (line: string) => void;
  inject?: {
    loadCases?: typeof loadCases;
    runEvalCase?: typeof runEvalCase;
    createOpenAILlm?: typeof createOpenAILlm;
    createEvalLogDir?: typeof createEvalLogDir;
    writeEvalCaseLog?: typeof writeEvalCaseLog;
    timeoutSignal?: () => AbortSignal;
  };
};
```

Defaults: `logRoot` is `join(process.cwd(), "eval-logs")`. `now` is `() => new Date()`. `timeoutSignal` is `() => AbortSignal.timeout(180_000)`. Keep the constant `CASE_TIMEOUT_MS` at `180_000`.

`createEvalLogDir(logRoot, now())` runs only after `loadCases` returns. If `loadCases` throws, do not create the directory and do not call `createOpenAILlm`. If create throws, exit 1 before `runEvalCase` and before `createOpenAILlm`. If the agent is unavailable, return 1 with the current message before `loadCases`, `createEvalLogDir`, and `createOpenAILlm`, and do not create `logRoot`.

For every case, after the existing timeout replacement, write that case's log and then print the same `formatResult` line as today, including when the write threw. A write error does not skip later cases. `formatResult` stays unchanged, including appending `error:` when `result.error` is set. Do not redact that field. Do not print prompts, completions, tool arguments, or UI trees on the case line.

Build the log from the case plus the result, after timeout replacement. Use `evalCase.id` as `id`:

```ts
const record: EvalCaseLog = {
  id: evalCase.id,
  prompt: evalCase.prompt,
  checks: evalCase.checks,
  ok: result.ok,
  failures: result.failures,
  trace: result.trace,
};
if (result.endedBy !== undefined) record.endedBy = result.endedBy;
if (result.error !== undefined) record.error = result.error;
```

If `result.trace` is `undefined` at runtime, do not call `writeEvalCaseLog`. Count a write failure with code `missing-trace` and write no file.

A safe error code is the thrown value's `code` when that `code` is a string matching `/^[A-Za-z0-9_-]+$/`. Otherwise the code is `Error`. Do not print `Error.message` or the trace. These three lines use single spaces:

```text
failed to create eval log directory ${code}
log failed ${id} ${code}
logs ${path.resolve(dir)}
```

The path line uses the same `log` function as the case lines, after the loop, including when a write failed or the case list was empty. It is not printed when the directory was not created. The process exits 0 only when every case passed and every log write succeeded. An empty case list still creates the directory, prints the path, calls `runEvalCase` zero times, and exits 0.

Add the line `eval-logs/` to `.gitignore`. Do not change `package.json`, `.github/workflows/ci.yml`, check kinds, the nine case files, the agent loop, or the system prompt.

Every test that gets past the missing-key return passes `logRoot` under `os.tmpdir()`, so `npm test` does not create `eval-logs` in the repo. Extend `server/eval/cli.test.ts`. Keep the committed-cases snapshot test.

## Acceptance

- Two cases in one `main` call write both `<id>.json` files in the same directory. That directory's basename equals `evalLogDirName(now)`. The last line passed to `log` is `logs` plus `path.resolve` of that directory.
- A second `main` call with the same `now` and `logRoot` returns 1, does not call `runEvalCase`, and does not call `createOpenAILlm`. Stderr is `failed to create eval log directory` plus an error code, and does not include a sentinel placed in the thrown error's message.
- `loadCases` throwing does not create the log directory and does not call `createOpenAILlm`.
- With `agentAvailable: false` and a `logRoot` under `os.tmpdir()`, that root is not created. The stderr line is still `OPENAI_API_KEY is required to run eval cases.` `loadCases`, `runEvalCase`, and `createOpenAILlm` are not called.
- The repository `.gitignore` has a line whose text is `eval-logs/`.
- An empty case list creates the directory, prints the `logs` line, calls `runEvalCase` zero times, and returns 0.
- Sentinels placed in the case prompt, completion `content`, tool `arguments`, and a UI tree appear in the JSON file and do not appear in stdout or stderr. The pass line is `pass` plus the id. The fail line still follows `formatResult`.
- When the injected timeout signal is already aborted, the file has `ok: false`, the failure reason `case timed out after 180 seconds`, and the trace returned by `runEvalCase`. The fail line contains that timeout reason. The original check failures are not the logged failures.
- A writer that throws an `Error` whose message is a sentinel and whose `code` is `EIO` prints `log failed <id> EIO` on stderr, still prints that case's `formatResult` line, still runs the next case, and the process returns 1 even if every case passed. The sentinel is not printed.
- A result with no `trace` prints `log failed <id> missing-trace`, writes no file for that id, and continues to the next case.
- When the string passed to the injected `createOpenAILlm` as `apiKey` is non-empty, that string appears in neither the JSON file nor stdout nor stderr. The written object has no `apiKey` and no system-prompt field.

## Validation

- `npm test` exits 0. The new assertions live in `server/eval/cli.test.ts`, which the existing `npm test` glob `server/**/*.test.ts` already runs. Database tests skip when `DATABASE_URL` and `TRACE_DATABASE_URL` are unset.
- `npm run typecheck` exits 0.
- `npm run build` exits 0.
- `npm run build:api` exits 0.

Do not run `npm run eval` in validation. It needs a live key and is covered below.

## After merge

- From the repo root, with `OPENAI_API_KEY` set, `npm run eval` prints one pass or fail line per committed case and a final `logs` line, and that directory contains one `.json` file per case id.
- `git status` does not list that `eval-logs` directory.
- The terminal output does not include the `simple-heading` prompt `Show a heading that says Hello`.
- An eval run does not add a row to `genui_traces`, and a normal chat turn still can.
