---
id: eval-docs
priority: 90
depends:
  - eval-repeat
  - eval-cases-update
touches:
  - README.md
  - docs/ARCHITECTURE.md
scope: small
---

# Document --repeat, the uiText and uiMarkupTag checks, and the 20 eval cases

## Sources

- [Eval findings fixes — R11](../plans/eval-findings-fixes.md#r11-eval-docs)

## Context

This builds on `eval-repeat`, which adds `npm run eval -- --repeat N`
(1 to 10; each case runs N times, each attempt prints
`pass <id> [k/N]` or `fail <id> [k/N] <reasons>` and is logged as
`<id>.<k>.json`; after all cases one `rate <id> <passes>/<N>` line per case,
then `logs <dir>`; with no flag or `--repeat 1`, output and `<id>.json` file
names are unchanged), and on `eval-cases-update`, which brings the committed
cases in `server/eval/cases/` to 20. The `uiText` check (passes when any
string in the last successful `render_ui` tree's props contains the text)
and `uiMarkupTag` check (passes when a Markup element with that tag appears
anywhere in that tree) come from `eval-text-checks`, which
`eval-cases-update` already required. Read the merged code in
`server/eval/` to confirm details before writing.

The docs are out of date today:

- `README.md`, the Scripts block line
  `npm run eval          # live OpenAI eval cases; gitignored eval-logs JSON per case ...`.
- `docs/ARCHITECTURE.md`:
  - §1, the bullet starting **Eval runs beside the HTTP API, not through
    it.**, which says the CLI writes one JSON file per case and prints one
    `pass` or `fail` line per case and a `logs` line.
  - §9, the `npm run eval` row of the commands table.
  - §10 ("Today"), the bullet starting **`npm run eval`** (§9), which says
    "nine committed live cases" and lists nine of the current 14.

## Scope

- README: the `npm run eval` line mentions `npm run eval -- --repeat N` and
  the per-attempt log names (`<id>.<k>.json`). Keep it one line in the
  Scripts block, matching its comment style.
- `docs/ARCHITECTURE.md` §1 eval bullet and §9 table row: describe repeats,
  per-attempt logs, `[k/N]` result lines and `rate` lines, and that a plain
  run is unchanged.
- `docs/ARCHITECTURE.md` §10 bullet: replace "nine committed live cases"
  with the 20 cases, listing every id in `server/eval/cases/` (sorted, as
  `loadCases` returns them) with one short phrase each in the bullet's
  existing style (`` `simple-heading` (catalog heading via `render_ui`) ``),
  and mention that checks can now read drawn text (`uiText`) and Markup tags
  (`uiMarkupTag`).

Documentation only; no code changes.

## Acceptance

- `README.md`'s `npm run eval` line mentions `npm run eval -- --repeat N`
  and the `<id>.<k>.json` per-attempt logs.
- `docs/ARCHITECTURE.md`'s §1 eval bullet and §9 `npm run eval` row describe
  `--repeat`, per-attempt logs and `rate` lines.
- The §10 eval bullet names all 20 case ids present in
  `server/eval/cases/`, each with one phrase, mentions `uiText` and
  `uiMarkupTag`, and no longer says "nine".
- Every repository link the edited text adds resolves.

## Validation

- `ls server/eval/cases/*.json | wc -l` prints 20, and each of those ids
  appears in the §10 bullet (for example
  `for f in server/eval/cases/*.json; do grep -q "\`$(basename "$f" .json)\`" docs/ARCHITECTURE.md || echo "missing $f"; done`
  prints nothing).
- `grep -n "nine committed" docs/ARCHITECTURE.md` prints nothing.
- `grep -n -- "--repeat" README.md docs/ARCHITECTURE.md` shows the README
  line and the ARCHITECTURE §1 and §9 text.
