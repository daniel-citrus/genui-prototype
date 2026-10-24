---
id: choice-select-error
priority: 50
depends: []
touches:
  - server/ui/validateTree.ts
  - server/ui/validateTree.test.ts
scope: small
---

# Ask for a Select when a choice input is missing

## Sources

- [Markup lists and choice selects — R3](../plans/markup-lists-and-choice-selects.md#r3-a-missing-choice-asks-for-a-select)
- [Markup lists and choice selects — Design](../plans/markup-lists-and-choice-selects.md#design)

## Context

`bindingProblems` in `server/ui/validateTree.ts` checks action inputs. It is private. `validateUiTree` is the public function and defaults `designChecks` to true. For each enabled button, and only when `designChecks` is true, a missing required property currently pushes:

```text
${button.path} action "${spec.name}" needs an input named "${key}"${where}, and none has that name
```

`where` is ` in its Card` when `button.card` is set, and empty otherwise. The loop sees only buttons for which `disabled` is falsy. A later loop, and only when `choiceValues` has loaded that source, tells a present non-Select input to use a Select. That sentence starts `fills "<name>" of action`. `ActionSpec.choices` in `server/actions/types.ts` maps an input name to a source name and does not depend on loaded values.

`server/customComponents/definition.ts` calls `validateUiTree` with `designChecks: false`, so saving a component does not report a missing action input. `render_ui` validates the expanded tree with the default. `rewritePaths` in `server/customComponents/expand.ts` replaces a path prefix with the agent's path, the component name, version, and `template`. It prefixes whatever sentence `bindingProblems` returns.

`server/ui/validateTree.test.ts` already has `signUp` (no `choices`, required `email`) and `updateItem` (`choices: { item: "menu_items" }`, required `item`, operation `edit`). `menuValues` is `{ menu_items: ["Bạc xỉu", "Cà phê sữa đá"] }`. These tests pin the old missing-input sentence:

- "refuses an action whose required property no input fills": `tree.children.0 action "sign_up" needs an input named "email", and none has that name`
- "skips the required check for a disabled Button but still checks its action": a disabled `sign_up` button produces no missing-input error; an enabled one still produces the email sentence above
- "requires each button's own Card to hold the action's inputs": `tree.children.1.children.1 action "menu_update_item" needs an input named "item" in its Card, and none has that name`
- "keeps the whole-design message for a button outside every Card": `tree.children.1 action "menu_update_item" needs an input named "item", and none has that name`

"refuses an input that isn't a Select, instead of the input-kind message" pins a present TextInput or Checkbox named `item`, with `menuValues` loaded, to `tree.children.0 fills "item" of action "menu_update_item", which takes one of the menu_items values: use a Select with those values as options`. "doesn't check a source missing from choiceValues" expects no error for a present TextInput or Select named `item` when `choiceValues` is omitted or lacks `menu_items`. "skips the missing-input and edit-form checks with designChecks: false" expects `form(submit)` with `signUp` to fail under the default and to return no errors with `designChecks: false`. The same test uses `form(itemSelect("Latte"), actionButton("menu_update_item"))`, which already has a Select named `item` and no optional field: it fails the edit check under the default and returns no errors with `designChecks: false`.

A local eval run `eval-logs/2026-10-24T01-12-26.466Z` (local only) had `per-item-edit-cards` read Select on its last tool-capable step after two rejected renders. An earlier local run `eval-logs/2026-10-24T01-04-05.959Z` (local only) passed that case with a disabled Select. This goal does not read or edit those logs or `server/eval/cases/per-item-edit-cards.json`.

The list-wording change is a separate goal, `list-markup-wording`. The prompt already tells the model to use a Select for a choice. These two goals share no files.

## Scope

In the missing-required loop inside `bindingProblems`, when `spec.choices?.[key]` is a non-empty string `source`, push:

```text
${button.path} action "${spec.name}" needs a Select named "${key}"${where}, with the ${source} values as its options, and none has that name
```

When that source is missing or `""`, keep the current `needs an input named` sentence. Do not read `choiceValues` in this branch. Leave the later `fills "<name>" of action` loop unchanged. Leave `validateUiTree`'s signature unchanged.

`where` stays ` in its Card` when the button has a card, and empty otherwise. Only required keys are considered, so a missing optional property does not by itself produce the new sentence. A disabled button still skips this loop. `designChecks: false` still skips it, so `define_component` does not start reporting a missing action input. Do not edit `server/customComponents/definition.ts` or `server/customComponents/expand.ts`. Because the new sentence still starts with `button.path`, `rewritePaths` still prefixes an expanded template path.

A Markup `select` that already has the right name is a present input, so the new sentence does not fire. If `choiceValues` is loaded, the existing wrong-kind sentence can still fire, because that element is not a Select. Leave that as it is. Do not dedupe repeated copies of the sentence, change `MAX_ERRORS`, or put the disabled-Select or `$prop` rule into the error.

Update "requires each button's own Card to hold the action's inputs" and "keeps the whole-design message for a button outside every Card" to the new sentences. Add the same missing `item` with `choiceValues` omitted, inside a card and outside every card. Keep the `sign_up` missing-email cases, the disabled-button case, the `designChecks: false` case, and the TextInput-named-`item` "use a Select" case.

## Acceptance

- Inside a card, a missing `item` for `menu_update_item` produces `tree.children.1.children.1 action "menu_update_item" needs a Select named "item" in its Card, with the menu_items values as its options, and none has that name`.
- Outside every card, the same miss produces `tree.children.1 action "menu_update_item" needs a Select named "item", with the menu_items values as its options, and none has that name`.
- Those two sentences are produced when `choiceValues` is `menuValues` and when `choiceValues` is omitted.
- A required input whose `choices` entry is missing or `""` still produces `needs an input named "<key>"`. `sign_up` missing `email` stays `tree.children.0 action "sign_up" needs an input named "email", and none has that name`, and the enabled button beside a disabled one stays `tree.children.1 action "sign_up" needs an input named "email", and none has that name`. Those two tests are outside every card. The same miss for a `sign_up` button inside a card must include ` in its Card`. That card sentence is not pinned today, so add it.
- A disabled button still does not require the action's inputs.
- `designChecks: false` still skips the missing-input check. The existing `sign_up` and `menu_update_item` cases in "skips the missing-input and edit-form checks with designChecks: false" still return no errors.
- A present TextInput or Checkbox named `item`, with `menu_items` loaded, still produces the existing `use a Select with those values as options` sentence, not the new missing-input sentence. The same present TextInput with `choiceValues` omitted still produces no error.
- A missing optional property does not by itself produce the new sentence. The edit-form sentence for an edit action that has only its required inputs stays as it is.

## Validation

- `npm test` exits 0. Database-backed suites skip when `DATABASE_URL` is unset. The tests this goal changes do not need it.
- `npm run typecheck` exits 0.

## After merge

- Run `npm run eval` with `OPENAI_API_KEY` and compare `per-item-edit-cards` with local logs `eval-logs/2026-10-24T01-12-26.466Z` and `eval-logs/2026-10-24T01-04-05.959Z` (local only). One run can still miss; the unit tests are the contract.
