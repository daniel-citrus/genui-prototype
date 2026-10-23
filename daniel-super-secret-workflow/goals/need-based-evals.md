---
id: need-based-evals
priority: 50
depends: []
touches:
  - server/eval/types.ts
  - server/eval/checks.ts
  - server/eval/checks.test.ts
  - server/eval/loadCases.ts
  - server/eval/loadCases.test.ts
  - server/eval/runner.ts
  - server/eval/runner.test.ts
  - server/eval/cli.test.ts
  - server/eval/cases/bullet-list-items.json
  - server/eval/cases/revenue-bar-chart.json
  - server/eval/cases/reusable-name-list.json
  - server/eval/cases/per-item-edit-cards.json
  - server/eval/cases/reuse-saved-card.json
  - server/eval/cases/star-rating.json
  - server/eval/cases/simple-heading.json
  - server/eval/cases/catalog-layout.json
  - server/eval/cases/closed-alert.json
  - server/eval/cases/echo-form.json
  - docs/ARCHITECTURE.md
scope: medium
---

# Evals for need-based components, reuse and Markup-free ordinary designs

## Sources

- [Component generation plan — R10 Need-based live evals](../plans/data-driven-components-and-card-forms.md#r10-need-based-live-evals)
- [Component generation plan — R16 Negative, reuse and rating evals](../plans/data-driven-components-and-card-forms.md#r16-negative-reuse-and-rating-evals)
- [Merged plan — Test autonomous selection and recovery](../abandoned/custom-component-decision-flow.md#5-test-autonomous-selection-and-recovery)

## Context

Every custom-component eval case today names the component and the tool, so
nothing checks that the agent decides on its own to repeat over data, draw
with Markup, use per-item Card forms, or reuse a saved component. Nothing
checks that ordinary designs stay free of Markup either.

Current eval code:

- `server/eval/types.ts`: `EvalCheck` is a union of `{ endedBy }`,
  `{ noError: true }`, `{ toolCalled }`, `{ toolNotCalled }`,
  `{ toolSucceeded }`, `{ uiComponent }`, `{ uiButtonAction }`,
  `{ uiNamedInput }`, `{ uiText }`, `{ uiMarkupTag }`, `{ agentComponent }`,
  `{ noButtonAction: true }`. `EvalCase` is `{ id, prompt, checks }`.
- `server/eval/checks.ts`: `lastSuccessfulRenderUi(trace)`,
  `treeHasComponent`, `checkLabel`, `evaluateCheck` and `checkTrace`. Failure
  reasons start with the check's label and never include user text,
  completion text, tool arguments or trees (pinned in `checks.test.ts`).
  `evaluateCheck` returns early with "no successful render_ui tree" for the
  checks after the tool checks. Each trace tool call records `call` (name and
  args), `result` (`ok`, `summary`) and an optional `skipped` reason.
- `server/eval/loadCases.ts` validates case files: `CHECK_KEYS` lists the
  allowed keys, `parseCheck` validates each, and `ENDED_BY` lists end reasons.
- `server/eval/runner.ts` `createEvalTools()` builds the tool registry from
  the catalog, a fresh `InMemoryCustomComponentRepository`, and the demo and
  menu actions; `runEvalCase` runs one case. `validateDefinition`
  (`server/customComponents/definition.ts`) checks a definition.
- `server/eval/cli.test.ts` pins the full list of committed case files in
  `committedCases` and asserts `loadCases` deep-equals it; adding a case
  means updating it. `docs/ARCHITECTURE.md` §10 lists the committed cases and
  the check kinds.
- `simple-heading`, `catalog-layout`, `closed-alert` and `echo-form` are the
  catalog-only cases.
- `npm run eval` needs `OPENAI_API_KEY` and isn't run in CI.

No build prerequisites: the checks, runner seeding and case files are
testable without the feature goals. The new cases pass live only once the
whole plan has merged (see After merge). The `eval-reply-checks` goal (plain
chat plan) also adds check kinds to `types.ts`, `checks.ts` and
`loadCases.ts`, adds cases to `cli.test.ts` and docs §10, and edits
`simple-heading.json`; if it has merged, build on it, otherwise keep your
additions as separate union members, check branches and array entries.
`build-recovery` adds `unresolved` to `ENDED_BY`; don't touch that set.

## Scope

Additive types:

```ts
// server/eval/types.ts
export type EvalCheck = /* existing */ | { definedWithKey: string } | { noUiComponent: string };
export interface EvalCase { /* existing */ customComponents?: CustomComponentDefinition[] }
```

- `definedWithKey`: passes when the arguments of a successful, not-skipped
  `define_component` call contain that key at any depth.
- `noUiComponent`: passes when the last successful `render_ui` tree doesn't
  contain that component; fails when there was no such render.
- Runner seeding: before the turn, check each `customComponents` entry with
  `validateDefinition` and save it into the run's in-memory repository. An
  invalid seed fails the case with `seed <name>: <first problem>`.
- `loadCases.ts` accepts both checks (rejecting a non-string) and
  `customComponents` (rejecting a non-array).
- New case files (prompts never name tools, components or Markup):

  | Case | Setup and prompt | Checks |
  |---|---|---|
  | `bullet-list-items` | "Show these as a simple bullet list: Espresso, Latte, Mocha." | `endedBy: reply`, `noError`, `toolSucceeded: render_ui`, `uiMarkupTag: li`, `uiText: Mocha` |
  | `revenue-bar-chart` | "Show monthly revenue as a bar chart: Jan $1,200, Feb $900, Mar $1,500." | `endedBy: reply`, `noError`, `toolSucceeded: render_ui`, `uiComponent: Markup`, `uiText: Mar` |
  | `reusable-name-list` | "Make a list I can reuse for any set of names, then show it with Ana, Bo and Cy." | `toolSucceeded: define_component`, `definedWithKey: $each`, `toolSucceeded: render_ui`, `uiText: Cy` |
  | `per-item-edit-cards` | "Show each menu item in its own card with a form to rename it." | `endedBy: reply`, `noError`, `toolSucceeded: render_ui`, `uiComponent: Card`, `uiButtonAction: menu_update_item`, `uiNamedInput: item` |
  | `reuse-saved-card` | Seeds `MenuItemCard` (a Card with a Heading `name` and a Text `price`). "Show the Latte at $4.50 using our saved menu item design." | `toolNotCalled: define_component`, `agentComponent: MenuItemCard`, `uiText: $4.50` |
  | `star-rating` | "Show a 4 out of 5 star rating for the Latte." | `endedBy: reply`, `noError`, `toolSucceeded: render_ui`, `uiComponent: Markup` |

- `simple-heading`, `catalog-layout`, `closed-alert` and `echo-form` gain
  `noUiComponent: Markup` and `toolNotCalled: define_component`.
- Update `cli.test.ts`'s `committedCases` and the case list and check kinds
  in `docs/ARCHITECTURE.md` §10.

## Acceptance

- `definedWithKey: "$each"` passes on a successful define whose template has
  `$each` nested anywhere, and fails when only a failed or skipped define has it.
- `noUiComponent: "Markup"` passes on a Markup-free last render, fails on one
  containing Markup, and fails when there was no successful render.
- Failure reasons for both checks start with their label and include no tool
  arguments or trees.
- A case with a valid `customComponents` seed runs with that component listed
  by `list_components` and usable in `render_ui`; an invalid seed fails the
  case with `seed <name>: <first problem>` without running the model.
- `loadCases` accepts the six new cases and the four updated ones, rejects a
  non-string `definedWithKey` / `noUiComponent` and a non-array
  `customComponents`.
- Seeds go only into the eval run's in-memory repository.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, with new tests:
  - `server/eval/checks.test.ts`: `definedWithKey` (nested pass, failed and
    skipped calls fail) and `noUiComponent` (pass, fail, no render).
  - `server/eval/runner.test.ts`: seeded components are listed and used with
    a scripted model; an invalid seed fails the case.
  - `server/eval/loadCases.test.ts`: the new checks and `customComponents`
    are accepted; a non-string key and a non-array list are rejected.
  - `server/eval/cli.test.ts`: the committed case list includes the six new files.
- `npm run build` and `npm run build:api` succeed.

## After merge

- Once every goal from the component-generation plan has merged, run `npm run eval -- --repeat 3` with an OpenAI key: the six new cases pass in most runs, the four catalog-only cases stay free of Markup and `define_component`, and the rest don't regress (compare with a run on the branch point).
