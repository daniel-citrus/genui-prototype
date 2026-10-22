---
id: eval-cases
priority: 50
depends:
  - agent-tree-checks
  - prompt-lines
touches:
  - server/eval/cases/archive-item.json
  - server/eval/cases/catalog-layout.json
  - server/eval/cases/closed-alert.json
  - server/eval/cases/export-pdf.json
  - server/eval/cases/framed-note.json
  - server/eval/cases/price-tag.json
  - server/eval/cli.test.ts
scope: small
---

# Add the five eval cases

## Sources

- [Eval improvements — R5](../plans/eval-improvements.md#r5-new-eval-cases)

## Context

`loadCases` in `server/eval/loadCases.ts` reads every `.json` file in a directory. Each file has `id`, `prompt`, and `checks`. The id is kebab-case and matches the file name. One check object has one key. `loadCases` returns the cases sorted by id. `server/eval/cli.test.ts` deep-equals that result for `server/eval/cases/` to the `committedCases` array, so a new or edited case updates both.

`runEvalCase` sends one prompt and then resets the conversation. Cases do not assert the words of the reply. `npm run eval` needs `OPENAI_API_KEY` and is not a CI step. Do not add it to `.github/workflows/ci.yml`.

The base this goal starts from already includes `agent-tree-checks`, which provides `{ "agentComponent": "<Name>" }` and `{ "noButtonAction": true }` and has changed `define-and-use-custom` to `agentComponent` `"PromoBanner"` plus `uiComponent` for Card, Heading, and Text. Keep that case. It also includes `prompt-lines`, which adds `Use a Checkbox for a boolean property.` to the system prompt. `archive-item` is a fair live check only with that sentence, because it expects a Checkbox for the boolean `archived` input.

`menu_set_item_archived` in `server/actions/menu/index.ts` takes `item` (choices, so a Select) and `archived` (boolean, so a Checkbox). No registered action exports a PDF. Alert, Markup, Checkbox, Select, and Button are catalog components. Markup stays in the expanded tree when it is used inside a template.

The nine existing cases are `catalog-layout`, `define-and-use-custom`, `delete-custom`, `echo-form`, `menu-create-item`, `menu-delete-category`, `mockup-no-action`, `off-topic-refusal`, and `simple-heading`. Their prompts and checks stay, except `catalog-layout` gains one check and `define-and-use-custom` already has the checks from `agent-tree-checks`.

## Scope

Add five case files and one check. Each file name is the id. Prompts and checks:

- `framed-note`. Prompt: `Define a reusable custom component named FramedNote that can contain children: a Card, and the children go inside that card. Then show FramedNote containing a Heading that says Pinned and a Text line under it.` Checks: `{ "endedBy": "reply" }`, `{ "noError": true }`, `{ "toolSucceeded": "define_component" }`, `{ "toolSucceeded": "render_ui" }`, `{ "agentComponent": "FramedNote" }`, `{ "uiComponent": "Card" }`, `{ "uiComponent": "Heading" }`, `{ "uiComponent": "Text" }`.
- `price-tag`. Prompt: `Define a custom component named PriceTag that uses Markup to draw a label no catalog component can: a span whose text is the price in bold. Then show PriceTag. Use Markup in the template.` Checks: `{ "endedBy": "reply" }`, `{ "noError": true }`, `{ "toolSucceeded": "define_component" }`, `{ "toolSucceeded": "render_ui" }`, `{ "agentComponent": "PriceTag" }`, `{ "uiComponent": "Markup" }`.
- `archive-item`. Prompt: `Show a form to archive a menu item or bring it back.` Checks: `{ "endedBy": "reply" }`, `{ "noError": true }`, `{ "toolCalled": "list_actions" }`, `{ "toolSucceeded": "render_ui" }`, `{ "uiButtonAction": "menu_set_item_archived" }`, `{ "uiNamedInput": "item" }`, `{ "uiNamedInput": "archived" }`, `{ "uiComponent": "Checkbox" }`, `{ "uiComponent": "Select" }`.
- `export-pdf`. Prompt: `Show a button labeled Export PDF. It should run a server action, but only if one of the registered actions actually exports a PDF.` Checks: `{ "endedBy": "reply" }`, `{ "noError": true }`, `{ "toolCalled": "list_actions" }`, `{ "toolSucceeded": "render_ui" }`, `{ "uiComponent": "Button" }`, `{ "noButtonAction": true }`.
- `closed-alert`. Prompt: `Show an alert that says the kitchen is closed. Do not add a button.` Checks: `{ "endedBy": "reply" }`, `{ "noError": true }`, `{ "toolNotCalled": "list_actions" }`, `{ "toolSucceeded": "render_ui" }`, `{ "uiComponent": "Alert" }`.

`catalog-layout` keeps its prompt and its current checks, and gains `{ "toolNotCalled": "list_actions" }` immediately after `{ "toolSucceeded": "render_ui" }`. The same check array is in `server/eval/cases/catalog-layout.json` and in `committedCases`.

`committedCases` lists the same cases `loadCases` returns, sorted by id: `archive-item`, `catalog-layout`, `closed-alert`, `define-and-use-custom`, `delete-custom`, `echo-form`, `export-pdf`, `framed-note`, `menu-create-item`, `menu-delete-category`, `mockup-no-action`, `off-topic-refusal`, `price-tag`, `simple-heading`.

These five cases, plus the `catalog-layout` check, are the whole of the new coverage. Do not add a second prompt to a case, assert reply wording, or register a PDF action.

## Acceptance

- `loadCases` on `server/eval/cases` returns these five cases plus the existing nine, and `catalog-layout` includes `toolNotCalled` `list_actions` with its other checks unchanged.
- Each new prompt and check list matches the lists above. Each new id is kebab-case and matches its file name.
- The deep-equal in `server/eval/cli.test.ts` passes, and `define-and-use-custom` still uses `agentComponent` PromoBanner and `uiComponent` Card, Heading, and Text.

## Validation

- `npm test` exits 0, including the committed-case deep-equal in `server/eval/cli.test.ts`.
- `npm run typecheck` exits 0.

## After merge

- Run `npm run eval` with `OPENAI_API_KEY` set, once `omit-empty-children` is also merged: `define-and-use-custom`, `delete-custom`, `simple-heading`, `catalog-layout`, `framed-note`, `price-tag`, `archive-item`, `export-pdf`, and `closed-alert` pass. This command does not force a cut-off call.
