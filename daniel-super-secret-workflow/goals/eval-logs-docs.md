---
id: eval-logs-docs
priority: 90
depends:
  - eval-cli-logs
touches:
  - docs/ARCHITECTURE.md
  - README.md
scope: small
---

# Document the gitignored eval log directory

## Sources

- [Eval logs plan — R5](../plans/eval-logs.md#r5-docs-name-the-log-directory)

## Context

This builds on `eval-cli-logs`, which makes `npm run eval` write one JSON file per case under a gitignored `eval-logs/<timestamp>/` directory and print one `pass` or `fail` line per case plus a final `logs <absolute path>` line. The file holds the case prompt, the checks, the result, and the full `AgentTrace`. Eval still needs `OPENAI_API_KEY`, is not run in CI, and still uses in-memory traces, so it does not write Postgres `genui_traces`.

`docs/ARCHITECTURE.md` does not mention `eval-logs`. The sentences to update are:

- The overview sentence that begins "Eval runs beside the HTTP API" (section 1, under the diagram). It says `npm run eval` loads committed JSON cases, calls the same agent loop and OpenAI adapter as chat, wires in-memory ports, scores the saved `AgentTrace`, and that CI does not run eval. It does not mention a log directory, the terminal path line, `OPENAI_API_KEY`, or `genui_traces`.
- The Eval subgraph in that same overview diagram. It contains `EvalCLI`, case files, trace checkers, and in-memory fakes. `EvalCLI` links to the case files and the trace checkers. There is no log-files node.
- The section 8 tree line for `server/eval/`: `` `server/eval/`: case files, trace checkers, runner, and CLI (`npm run eval`) ``. It does not mention the log writer.
- The section 9 table row for `npm run eval`: "Runs every committed eval case through the live agent (OpenAI, same model and system prompt as chat); needs `OPENAI_API_KEY` and is not run in CI".
- The section 10 bullet that begins with `npm run eval`. It names the nine committed cases and ends with "The runner uses in-memory ports and does not write `genui_traces`."

`README.md` "Other scripts" has this line:

```text
npm run eval          # live OpenAI eval cases (needs OPENAI_API_KEY; same model as chat; not run in CI)
```

Do not change `package.json` or `.github/workflows/ci.yml`. No new test.

## Scope

Update only `docs/ARCHITECTURE.md` and `README.md` so they describe the log directory `eval-cli-logs` writes. Keep the nine case names in the section 10 bullet. Keep the statements that eval needs `OPENAI_API_KEY`, is not run in CI, and does not write `genui_traces`.

In the overview diagram's Eval subgraph, add one node for the gitignored per-run JSON log files and an edge from the Eval CLI node to that node.

## Acceptance

- The overview sentence that begins "Eval runs beside the HTTP API" says that `npm run eval` writes one JSON file per case under a gitignored `eval-logs` directory, that the file holds the full turn trace, and that the terminal prints one result line per case plus the directory path. That same sentence says eval needs `OPENAI_API_KEY`, is not run in CI, and does not write `genui_traces`.
- The section 9 table row for `npm run eval` says the same facts.
- The section 10 bullet that begins with `npm run eval` says the logs are local files and the run still does not write `genui_traces`.
- The Eval subgraph in the overview diagram has one node for those log files, linked from the Eval CLI node.
- The section 8 tree line for `server/eval/` mentions the log writer.
- The README "Other scripts" line for `npm run eval` mentions the gitignored log directory and still says the command needs `OPENAI_API_KEY` and is not run in CI.

## Validation

- No new test. Read `docs/ARCHITECTURE.md` and `README.md` and confirm each Acceptance sentence against the edited text.
- `npm test` exits 0. This goal changes no test. Database tests skip when `DATABASE_URL` and `TRACE_DATABASE_URL` are unset.

Do not run `npm run eval`. It needs `OPENAI_API_KEY`.
