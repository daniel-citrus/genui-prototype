# Log the model's repair rounds in eval logs

## Overview

The old agent trace was removed. Its closest successor is the per-case JSON log that `npm run eval` writes (`server/eval/cli.ts`, `server/eval/writeLog.ts`). Each attempt in that log records the raw reply, the model's tree and its problems (`GenerationAttempt` in `server/generate/generate.ts`). Two things about repair rounds are still missing. First, the log never records the repair message the generator sent back to the model (`repairMessages` in `server/generate/prompt.ts`). Second, a case that fails with an error loses every attempt it made. That happens when a model call throws or the 180-second case timeout aborts the generation mid-repair: `runEvalCase` (`server/eval/runner.ts`) then returns no generation, and the log shows `attempts: []`.

This change fixes both, in eval logs only. Every attempt after the first records the exact repair message that asked for it. The generator also appends each attempt to an optional list the runner hands in, so a failed or timed-out case still logs, and counts usage for, the calls it completed. The API route doesn't pass that list. Its responses and its "design generated" log line stay the same, and the design is still never logged by the API. Out of scope: the silent fixes that `tidyDesign` and `omitEmptyChildren` make, per-attempt timing, and any persisted trace store. Update the eval log description in `docs/ARCHITECTURE.md` (§9 and the eval bullet).

- In a case that needed repairs, each attempt after the first has a `repairPrompt` holding exactly the user message sent before that call: the previous attempt's problems followed by the "Reply again…" request. The first attempt has no `repairPrompt`.
- A case whose model call throws during a repair logs the attempts completed before the throw, each with its problems, along with the error.
- A case that times out during a repair logs the attempts completed so far, plus the timeout failure, instead of `attempts: []`.
- The run's `usage` line counts the calls and tokens of those partial attempts.
- `POST /api/generate` answers and its log line are unchanged (the existing route tests still pass).
- `npm run typecheck` and `npm test` pass, with new cases in `server/generate/generate.test.ts`, `server/eval/runner.test.ts` and `server/eval/cli.test.ts`.

## After merge

- With `OPENAI_API_KEY` set, `npm run eval -- --repeat 3` writes at least one log whose second attempt shows a `repairPrompt` that matches the first attempt's problems.
