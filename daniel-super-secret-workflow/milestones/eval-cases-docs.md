---
id: eval-cases-docs
priority: 90
depends:
  - eval-live-cases
touches:
  - docs/ARCHITECTURE.md
  - README.md
scope: small
---

# Document nine live eval cases

## Sources

- [Eval cases plan — R12](../plans/eval-cases.md#r12-docs-list-the-live-cases)

## Context

After `eval-live-cases`, `npm run eval` runs nine committed JSON cases with in-memory ports; CI still does not run eval. `docs/ARCHITECTURE.md` §9 (eval harness) and the §9 bullet under limitations currently say only two cases (`simple-heading`, `echo-form`). `README.md` already mentions eval in one line and does not claim "two cases" only—update it only if it still says there are two cases.

The uncommitted architecture-diagram edit on some checkouts is out of scope; this goal updates the case list in §9/§10 text only.

## Scope

- Update `docs/ARCHITECTURE.md` so a reader of the eval section (§9 and/or the limitations bullet that describes `npm run eval`) can name all nine case ids and what each exercises, and the doc still states CI does not run `npm run eval` and eval uses in-memory ports without writing `genui_traces`.
- Touch `README.md` only if it still implies only two cases.

Case ids and intent (for the doc):

| id | intent |
|---|---|
| `simple-heading` | catalog heading via `render_ui` |
| `echo-form` | form with `demo_echo` action |
| `catalog-layout` | stacked card with catalog components |
| `menu-create-item` | café menu create form |
| `menu-delete-category` | menu category delete with confirm |
| `define-and-use-custom` | define then show custom component |
| `delete-custom` | define then delete custom component |
| `mockup-no-action` | mockup must not call `list_actions` |
| `off-topic-refusal` | non-UI question, no design tools |

## Acceptance

- Architecture docs list all nine ids with enough context that a reader understands what each case is for.
- Docs still say eval is not run in CI and uses the same live OpenAI path with in-memory ports as before.
- README remains accurate; no stale "two cases" wording if any existed.

## Validation

- `npm run typecheck` exits 0 (docs-only change should not break the tree).
- Manual review: open `docs/ARCHITECTURE.md` and confirm nine ids and CI note as above.

## After merge

- Skim `docs/ARCHITECTURE.md` in the browser or editor once merged to confirm §9/§10 reads coherently with the rest of the doc.
