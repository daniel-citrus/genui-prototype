---
id: eval-log-writer
priority: 20
depends: []
touches:
  - server/eval/writeLog.ts
  - server/eval/writeLog.test.ts
scope: medium
---

# Write one JSON eval log per case

## Sources

- [Eval logs plan — R2](../plans/eval-logs.md#r2-one-json-file-per-case)
- [Eval logs plan — Design](../plans/eval-logs.md#design)

## Context

Eval results are not written to disk. `server/eval/loadCases.ts` keeps case ids to `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`. That constant is private. `AgentTrace` lives in `server/agent/trace.ts`. `EvalCheck` and `CheckFailure` live in `server/eval/types.ts`. `EndedBy` is `"reply" | "max_steps" | "tool_budget" | "token_budget" | "stopped"`.

This goal adds the file writer only. It does not call the model, read `process.cwd()`, or change the CLI. `eval-cli-logs` is what calls these functions from `main`. `EvalCaseResult.trace` is added by `eval-case-trace` in `server/eval/types.ts`. This goal does not edit that file. `EvalCaseLog` is its own interface in the new module.

Tests use Node's test runner (`node:test`, `node:assert/strict`) and run under `tsx`. `npm test` is `tsx --tsconfig ./tsconfig.server.json --test --test-concurrency=1 "server/**/*.test.ts" "src/**/*.test.ts"`. Node is `>=24`.

## Scope

Add `server/eval/writeLog.ts` with this surface and no other exports that pull in a model, a filesystem root, or the network:

```ts
export interface EvalCaseLog {
  id: string;
  prompt: string;
  checks: EvalCheck[];
  ok: boolean;
  failures: CheckFailure[];
  endedBy?: EndedBy;
  error?: string;
  trace: AgentTrace;
}

export function evalLogDirName(now: Date): string;

export function createEvalLogDir(root: string, now: Date): string;

export function writeEvalCaseLog(dir: string, log: EvalCaseLog): void;
```

`evalLogDirName` returns `now.toISOString().replaceAll(":", "-")`, one path segment. `new Date("2026-10-22T12:31:05.123Z")` yields `2026-10-22T12-31-05.123Z`.

`createEvalLogDir` creates `root` with `recursive: true`, then creates `join(root, evalLogDirName(now))` without `recursive`, so an existing directory throws. It returns that path.

`writeEvalCaseLog` checks `log.id` with `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, the same rule as `loadCases`. Duplicate the regex here. Do not export it from `loadCases.ts` and do not edit that file. A failing id throws `Error` with message `eval log id must be kebab-case` and writes no file.

It writes `join(dir, id + ".json")` only when `path.relative` of the resolved file against the resolved directory does not start with `..` and is not absolute. Otherwise it throws `Error` with message `eval log path escapes the directory` and writes no file. The body is `JSON.stringify(object, null, 2) + "\n"` with `flag: "wx"` and encoding `utf8`. A second write of the same path throws from that flag and leaves the first file unchanged. Do not catch that error.

Build the object in this key order: `id`, `prompt`, `checks`, `ok`, `failures`, then `endedBy` only when it is not `undefined`, then `error` only when it is not `undefined`, then `trace`. `trace` is the full `AgentTrace`. `JSON.stringify` drops `undefined`. Do not add `apiKey`, a system-prompt field, or any other top-level key.

Add `server/eval/writeLog.test.ts`. Use a temporary directory, not the repo and not `eval-logs/` under the process cwd.

## Acceptance

- A log with `endedBy` and no `error` round-trips through `JSON.parse`, and `Object.keys` are `id`, `prompt`, `checks`, `ok`, `failures`, `endedBy`, `trace`, in that order. The file is UTF-8, pretty-printed with two-space indent, and ends with a newline.
- A defined completion `content`, tool `arguments` string, and `ui` tree round-trip unchanged. A log with `error` and no `endedBy` omits `endedBy` and includes `error`.
- An id that is not kebab-case, including one with a slash or `..`, throws `eval log id must be kebab-case`, and no file appears outside the directory. Those ids fail the kebab-case check before the path check.
- A second write of the same id in the same directory throws and leaves the first file unchanged.
- The top-level keys are only those listed above. There is no `apiKey` and no system-prompt field.
- `evalLogDirName` of `new Date("2026-10-22T12:31:05.123Z")` is `2026-10-22T12-31-05.123Z` and contains no `/` and no `:`.
- Calling `createEvalLogDir` twice with the same root and `Date` throws the second time, and the first directory is still there. The first call's return value is that directory.

## Validation

- `npm test` exits 0. This goal introduces `server/eval/writeLog.test.ts`. The existing `npm test` glob `server/**/*.test.ts` runs it. Database tests skip when `DATABASE_URL` and `TRACE_DATABASE_URL` are unset.
- `npm run typecheck` exits 0.
- `npm run build` exits 0.
- `npm run build:api` exits 0.

Do not run `npm run eval`. It needs `OPENAI_API_KEY`.
