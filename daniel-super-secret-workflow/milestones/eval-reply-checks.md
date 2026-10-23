---
id: eval-reply-checks
priority: 50
depends: []
touches:
  - server/eval/types.ts
  - server/eval/checks.ts
  - server/eval/checks.test.ts
  - server/eval/loadCases.ts
  - server/eval/loadCases.test.ts
  - server/eval/cli.test.ts
  - server/eval/cases/plain-short-reply.json
  - server/eval/cases/simple-heading.json
  - server/eval/cases/off-topic-refusal.json
  - docs/ARCHITECTURE.md
scope: small
---

# Eval checks for reply length and jargon

## Sources

- [Simpler chat plan — R3 Eval measures reply length and jargon](../plans/plain-chat-and-new-chat.md#r3-eval-measures-reply-length-and-jargon)
- [Simpler chat plan — Interfaces (Eval)](../plans/plain-chat-and-new-chat.md#interfaces)

## Context

The agent is being told (in a separate goal, `plain-brief-replies`) to reply
in one or two short sentences of everyday words. Eval has no way to measure
reply length or jargon, so that can't be confirmed or protected from
regressions.

Eval today:

- `server/eval/types.ts`: the `EvalCheck` union (`endedBy`, `noError`,
  `toolCalled`, `toolNotCalled`, `toolSucceeded`, `uiComponent`,
  `uiButtonAction`, `uiNamedInput`, `uiText`, `uiMarkupTag`,
  `agentComponent`, `noButtonAction`).
- `server/eval/checks.ts`: `checkTrace(trace, checks)`; `checkLabel` builds a
  label per check and `evaluateCheck` returns a `CheckFailure` whose `reason`
  starts with the label. Reasons never include user text, completion text,
  tool arguments or trees; `server/eval/checks.test.ts` pins this ("fail
  reasons omit userText, completion text, tool args, and tree JSON"). Note
  `evaluateCheck` returns early with a "no successful render_ui tree" failure
  for every check after the tool checks; the reply checks must be evaluated
  before that, since they don't need a design.
- `server/eval/loadCases.ts`: `CHECK_KEYS` lists allowed keys; `parseCheck`
  validates each, with errors like `${context}: <key> must be a non-empty
  string`, where `context` names the case file and check index.
- A turn's text is `AgentTrace.completions[].content` (`server/agent/trace.ts`,
  `string | null`).
- Committed cases are `server/eval/cases/*.json` (20 today);
  `server/eval/cli.test.ts` pins the full list in `committedCases` and asserts
  `loadCases(committedCasesDir)` deep-equals it.
- `docs/ARCHITECTURE.md` §10 lists the committed cases ("runs 20 committed
  live cases … `archive-item` (…); … `sms-no-action` (…)") and names the
  check kinds it can read.
- `npm run eval` needs `OPENAI_API_KEY` and is not run in CI.

## Scope

Additive changes to eval only:

```ts
export type EvalCheck =
  | /* existing members */
  | { replyMaxWords: number }
  | { replyExcludes: string };
```

- `checks.ts` adds `replyText(trace: AgentTrace): string`: the non-null
  `content` of every completion, joined with `"\n"`.
- `replyMaxWords`: label `replyMaxWords <n>`; passes when `replyText` split on
  whitespace has at most `n` words (empty text is zero words); failure reason
  `replyMaxWords <n>: reply has <count> words`.
- `replyExcludes`: label `replyExcludes "<s>"`; passes when `replyText` does
  not contain `s` (case-sensitive, like `uiText`); failure reason
  `replyExcludes "<s>": reply contains the excluded text`.
- `loadCases.ts` accepts both keys: `replyMaxWords` must be an integer from 1
  to 500; `replyExcludes` must be a non-empty string.
- New case `server/eval/cases/plain-short-reply.json`: prompt "Make a welcome
  card with a title and a short greeting"; checks `endedBy: reply`,
  `noError: true`, `toolSucceeded: render_ui`, `replyMaxWords: 40`, and one
  `replyExcludes` each for `render_ui`, `list_components`, `get_component`,
  `props` and `Stack`.
- `simple-heading.json` and `off-topic-refusal.json` each gain
  `{ "replyMaxWords": 40 }`.
- Update `cli.test.ts`'s `committedCases` and `docs/ARCHITECTURE.md` §10's
  case count (21) and list, and mention the reply checks there.

40 words is the agreed limit for "one or two short sentences". Existing case
files stay valid.

## Acceptance

- A case with `{ "replyMaxWords": 40 }` passes on a trace whose completions'
  text totals 40 words and fails at 41, counting across several completions
  and treating null content as empty.
- A case with `{ "replyExcludes": "Stack" }` passes when no completion text
  contains "Stack", fails when one does, and is case-sensitive ("stack" does
  not fail it).
- `loadCases` rejects `replyMaxWords` of `0`, `501`, `1.5` or a string, and an
  empty or non-string `replyExcludes`, with an error naming the case file and
  the key.
- Failure reasons for both checks name the check and its value (and the word
  count for `replyMaxWords`) but never contain reply text, user text, tool
  arguments or trees; the existing reasons-omit-secrets test covers the new
  checks with planted completion text.
- `plain-short-reply` exists with the checks above; `simple-heading` and
  `off-topic-refusal` include `replyMaxWords: 40`.
- `loadCases(server/eval/cases)` loads 21 cases, matching `cli.test.ts`'s
  committed list, and `docs/ARCHITECTURE.md` lists the same 21.

## Validation

- `npm run typecheck` succeeds.
- `npm test` passes, including new tests in `server/eval/checks.test.ts` and
  `server/eval/loadCases.test.ts` and the updated committed-case list in
  `server/eval/cli.test.ts` (these tests are written by this goal).
- `npm run build:api` succeeds.

## After merge

- `npm run eval` with `OPENAI_API_KEY`, once `plain-brief-replies` is also merged: all 21 cases pass, including `plain-short-reply` and the new `replyMaxWords` checks.
- `npm run eval -- --repeat 5` with `OPENAI_API_KEY`: the reply checks pass on most attempts.
