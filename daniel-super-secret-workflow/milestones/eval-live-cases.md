---
id: eval-live-cases
priority: 50
depends:
  - eval-check-tool-not-called
touches:
  - server/eval/cases/simple-heading.json
  - server/eval/cases/echo-form.json
  - server/eval/cases/catalog-layout.json
  - server/eval/cases/menu-create-item.json
  - server/eval/cases/menu-delete-category.json
  - server/eval/cases/define-and-use-custom.json
  - server/eval/cases/delete-custom.json
  - server/eval/cases/mockup-no-action.json
  - server/eval/cases/off-topic-refusal.json
  - server/eval/cli.test.ts
scope: medium
---

# Add seven live eval cases and committed-case snapshot

## Sources

- [Eval cases plan — R3–R11](../plans/eval-cases.md#r3-keep-the-two-starter-cases)

## Context

`npm run eval` runs every `*.json` in `server/eval/cases/`. Today only `simple-heading` and `echo-form` exist; `server/eval/cli.test.ts` asserts those two objects exactly.

This builds on `eval-check-tool-not-called`, which adds `{ toolNotCalled: string }` to the harness. Each `runEvalCase` uses a fresh in-memory custom-component store and menu. File names must equal `{id}.json`. Prompts below are exact committed wording.

Keep `simple-heading.json` and `echo-form.json` unchanged (same `id`, `prompt`, and `checks` as today).

Add these seven files:

**catalog-layout** — Prompt: `Show a Card titled Specials. Inside it put a Heading that says Today's drinks and a Text line under the heading. Group them with a Stack.` Checks: `endedBy: reply`, `noError`, `toolSucceeded: render_ui`, `uiComponent` for `Stack`, `Card`, `Heading`, `Text`.

**menu-create-item** — Prompt: `Show a form to add a new drink to the café menu.` Checks: `endedBy: reply`, `noError`, `toolCalled: list_actions`, `toolSucceeded: render_ui`, `uiButtonAction: menu_create_item`, `uiNamedInput` for `name`, `size`, `price`.

**menu-delete-category** — Prompt: `Show a form to delete a menu category. Say that the person will be asked to confirm before it runs.` Checks: `endedBy: reply`, `noError`, `toolCalled: list_actions`, `toolSucceeded: render_ui`, `uiButtonAction: menu_delete_category`, `uiNamedInput: category`.

**define-and-use-custom** — Prompt: `Define a reusable custom component named PromoBanner: a Card whose children are a Heading and a Text. Then show PromoBanner.` Checks: `endedBy: reply`, `noError`, `toolSucceeded: define_component`, `toolSucceeded: render_ui`, `uiComponent: PromoBanner`.

**delete-custom** — Prompt: `Define a custom component named TempNotice that is a Card with a Heading. Then delete TempNotice. You do not need to show it.` Checks: `endedBy: reply`, `noError`, `toolSucceeded: define_component`, `toolSucceeded: delete_component`. Do not require `render_ui` or UI checks.

**mockup-no-action** — Prompt: `Show a mockup signup form with an email field, a password field, and a Create account button. The button must not run a server action.` Checks: `endedBy: reply`, `noError`, `toolNotCalled: list_actions`, `toolSucceeded: render_ui`, `uiComponent: TextInput`, `uiComponent: Button`.

**off-topic-refusal** — Prompt: `What's the weather in Paris tomorrow?` Checks: `endedBy: reply`, `noError`, `toolNotCalled: list_components`, `toolNotCalled: list_actions`, `toolNotCalled: render_ui`.

Update `server/eval/cli.test.ts` so `loadCases` on the committed directory returns nine cases sorted by id (`catalog-layout`, `define-and-use-custom`, `delete-custom`, `echo-form`, `menu-create-item`, `menu-delete-category`, `mockup-no-action`, `off-topic-refusal`, `simple-heading`), each matching the prompt and checks above. The test must not call OpenAI.

Out of scope: changing the agent loop, system prompt, tools, or actions; CI eval; new check kinds beyond what the prerequisite goal added.

## Scope

- Add seven JSON case files under `server/eval/cases/`.
- Leave the two starter cases bit-for-bit on `id`, `prompt`, and `checks`.
- Expand `cli.test.ts` to snapshot all nine committed cases.

## Acceptance

- `loadCases` on `server/eval/cases` returns exactly nine cases with the ids and ordering above.
- Each case object's `prompt` and `checks` match this goal's specifications.
- `simple-heading` and `echo-form` objects remain identical to what `cli.test.ts` asserted before this change.
- No OpenAI calls in unit tests for the committed-case snapshot.

## Validation

- `npm run typecheck` exits 0.
- `npm test` exits 0, including the updated `server/eval/cli.test.ts` committed-case test.
- `npm run build` and `npm run build:api` exit 0.

## After merge

- With `OPENAI_API_KEY` set, `npm run eval` prints nine `pass <id>` lines and exits 0; if a case fails, use check names only to decide whether to tighten a prompt or fix agent procedure (do not weaken structural checks).
