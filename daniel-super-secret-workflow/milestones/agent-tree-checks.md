---
id: agent-tree-checks
priority: 20
depends: []
touches:
  - server/eval/types.ts
  - server/eval/checks.ts
  - server/eval/checks.test.ts
  - server/eval/loadCases.ts
  - server/eval/loadCases.test.ts
  - server/eval/cases/define-and-use-custom.json
  - server/eval/cli.test.ts
scope: medium
---

# Check the component the agent named

## Sources

- [Eval improvements — R4](../plans/eval-improvements.md#r4-agent-tree-checks)

## Context

Eval checks in `server/eval/checks.ts` use `lastSuccessfulRenderUi`: the last `render_ui` whose result is ok, whose `ui` is present, and which was not skipped. `uiComponent`, `uiButtonAction`, and `uiNamedInput` then read `ui.tree`, the expanded sandbox tree. `treeHasComponent` walks `component` and `children` and does not enter `props`. `collectBindings` in `server/ui/bindings.ts` records a Button or a Markup `button` only when it has a string `action`. A Button with no `action` is absent from `bindings.buttons`.

The no-render sentence is the constant `NO_RENDER_UI`: `no successful render_ui tree on trace (result.ok, ui present, not skipped)`. Reasons are `${label}: ${detail}`. `checkLabel` currently falls through to `uiNamedInput`, so a new check needs its own branch.

`EvalCheck` in `server/eval/types.ts` is a union of one key each. `CHECK_KEYS` in `server/eval/loadCases.ts` lists those keys. `parseCheck` rejects zero keys, two keys, an empty string, and `noError` other than `true`. `server/eval/loadCases.test.ts` covers those refusals with a temp directory.

`server/eval/cases/define-and-use-custom.json` ends with `{ "uiComponent": "PromoBanner" }`. The sandbox tree after expansion is Card, Heading, and Text, so that check fails when the agent did render PromoBanner. `server/eval/cli.test.ts` deep-equals `loadCases` of `server/eval/cases/` to the `committedCases` array, which repeats that check.

`server/eval/checks.test.ts` has "fail reasons omit userText, completion text, tool args, and tree JSON". It plants `DISTINCTIVE_USER_TEXT`, `completion-text-must-not-leak`, and `tool-args-must-not-leak`. Reasons must stay fixed sentences.

`uiComponent` keeps meaning the sandbox tree. `agentComponent` and `noButtonAction` are new keys. A failed or skipped `render_ui` is ignored. The last successful one wins.

## Scope

Add `{ agentComponent: string }` and `{ noButtonAction: true }` to `EvalCheck`. Add `agentComponent` and `noButtonAction` to `CHECK_KEYS`. `agentComponent` is a non-empty string, same rule as `uiComponent`. `noButtonAction` must be `true`, same rule as `noError`, and any other value throws a message that says `noButtonAction must be true`. A check with two keys is still rejected, including when one key is new.

`agentComponent` reads `call.args.tree` on that last successful `render_ui`, using the same `component` and `children` walk as `treeHasComponent`. It does not read `ui.tree` and it does not search `props`. Labels and reasons, with the name filled in:

- `agentComponent "PromoBanner": component not found in the render_ui arguments`
- `agentComponent "PromoBanner": no successful render_ui tree on trace (result.ok, ui present, not skipped)` when there is no successful render, reusing `NO_RENDER_UI`
- `agentComponent "PromoBanner": arguments tree is missing` when `call.args.tree` is absent

`noButtonAction` reads the same render's `ui.tree`. It passes when that tree contains a Button and `collectBindings(tree).buttons` is empty. Reasons:

- `noButtonAction: a button has an action` when the tree contains a Button and `collectBindings` found a button action
- `noButtonAction: no Button in the last render_ui tree` when the tree contains no Button
- `noButtonAction: no successful render_ui tree on trace (result.ok, ui present, not skipped)` when there is no successful render

Check for no successful render first. Then, for `noButtonAction`, a missing Button wins over a collected action, so a Markup button with an action and no Button component fails with the no-Button reason. A Button with no `action` passes. A Button whose `action` is a string fails with the action reason.

Extend the leak test so a secret planted in the user text, the completion text, the tool arguments, and the tree JSON does not appear in reasons for `agentComponent` and `noButtonAction`. Cover a successful render whose failure reason would otherwise be tempted to quote the tree or the arguments, not only the no-render path.

Replace the PromoBanner `uiComponent` check on `define-and-use-custom`. Keep `endedBy` `"reply"`, `noError` true, `toolSucceeded` `"define_component"`, and `toolSucceeded` `"render_ui"`. The checks are then `agentComponent` `"PromoBanner"` and `uiComponent` for `"Card"`, `"Heading"`, and `"Text"`. There is no `uiComponent` `"PromoBanner"`. Update the matching object in `committedCases` in `server/eval/cli.test.ts` to the same checks. Leave the other eight committed cases as they are.

## Acceptance

- A trace whose `render_ui` arguments are a PromoBanner and whose sandbox tree is a Card passes `agentComponent` PromoBanner and fails `uiComponent` PromoBanner.
- `agentComponent` fails with `component not found in the render_ui arguments` when the arguments tree has no such component, with `arguments tree is missing` when `call.args.tree` is absent, and with the no-render sentence when there is no successful `render_ui`.
- `noButtonAction` passes for a Button with no `action`. It fails with `a button has an action` when a Button has an `action`. It fails with `no Button in the last render_ui tree` when the tree has no Button. It fails with the no-render sentence when there is no successful render.
- A check reason for a planted secret in the user text, completion, arguments, and tree does not contain that secret.
- `loadCases` loads `{ "agentComponent": "PromoBanner" }` and `{ "noButtonAction": true }`, and rejects `{ "noButtonAction": false }` and a check that sets two keys.
- The committed `define-and-use-custom` case and the matching object in `server/eval/cli.test.ts` use `agentComponent` PromoBanner and `uiComponent` Card, Heading, and Text, and do not use `uiComponent` PromoBanner. `npm test` deep-equals `loadCases` of `server/eval/cases` to `committedCases`.

## Validation

- `npm test` exits 0, including `server/eval/checks.test.ts`, `server/eval/loadCases.test.ts`, and `server/eval/cli.test.ts`.
- `npm run typecheck` exits 0.
