---
id: eval-text-checks
priority: 20
depends: []
touches:
  - server/eval/types.ts
  - server/eval/checks.ts
  - server/eval/checks.test.ts
  - server/eval/loadCases.ts
  - server/eval/loadCases.test.ts
scope: small
---

# Add uiText and uiMarkupTag eval checks

## Sources

- [Eval findings fixes — R5, R6, Interfaces](../plans/eval-findings-fixes.md#r5-uitext-eval-check)

## Context

The `price-tag` eval case passed although the design showed the literal
`{{props.price}}`, because no eval check reads what a design draws. This goal
adds two checks so cases can assert drawn text and Markup tags. The
`eval-cases-update` goal builds on it: its committed cases use both checks,
so `loadCases` must accept them first.

Current code:

- `server/eval/types.ts`: `EvalCheck` is a union of single-key objects
  (`endedBy`, `noError`, `toolCalled`, `toolNotCalled`, `toolSucceeded`,
  `uiComponent`, `uiButtonAction`, `uiNamedInput`, `agentComponent`,
  `noButtonAction`).
- `server/eval/checks.ts`: `evaluateCheck` handles the trace-level checks,
  then gets `lastSuccessfulRenderUi(trace)` and returns
  `` `${label}: ${NO_RENDER_UI}` `` when there is none. `uiComponent`,
  `noButtonAction`, `uiButtonAction` and `uiNamedInput` read
  `renderUi.ui.tree`, the expanded tree of catalog component nodes
  `{component, props, children}`. A `Markup` node's `props.root` is a Markup
  element `{tag, attrs?, style?, text?, action?, children?}`. `checkLabel`
  builds each check's label, and its final fallback returns the
  `uiNamedInput` label, as does `evaluateCheck`'s final branch, so new kinds
  must be handled before those fallbacks.
- `server/eval/loadCases.ts`: `CHECK_KEYS` lists allowed check keys, and
  `parseCheck` parses `toolCalled`, `uiComponent` and the other string
  checks in one switch branch that throws
  `` `${context}: ${key} must be a non-empty string` ``.

## Scope

- `server/eval/types.ts`: add `| { uiText: string } | { uiMarkupTag: string }`
  to `EvalCheck` (additive).
- `server/eval/loadCases.ts`: add `"uiText"` and `"uiMarkupTag"` to
  `CHECK_KEYS` and parse both in the existing non-empty-string branch.
- `server/eval/checks.ts`:
  - `checkLabel`: `uiText "<text>"` and `uiMarkupTag "<tag>"`.
  - `uiText`: collect every string under each tree node's `props`,
    recursively through objects and arrays (so Markup `root` text and
    attribute values at any depth count), and over each node's `children`.
    Passes when any collected string contains the check's text
    (case-sensitive `includes`). Searches only the drawn tree, never the
    reply text or the `render_ui` arguments.
  - `uiMarkupTag`: walk every node whose `component` is `Markup`, anywhere in
    the tree, and that node's `props.root` and its element `children` at any
    depth; passes when an element's `tag` equals the check's value.
  - Both use the last successful `render_ui` tree and keep the existing
    no-render failure.

## Acceptance

- `uiText "Ada"` passes when a Heading's `props.text` is `"Hello Ada"`.
- `uiText "$12.99"` passes when a Markup root child's `text` is `"$12.99"`.
- `uiText` fails with reason `uiText "<text>": text not found in last render_ui tree`
  when no string contains it, including a case-only mismatch (`"ada"`
  against `"Hello Ada"`).
- `uiMarkupTag "strong"` passes for a Markup node whose root is a `span`
  with a `strong` child, and also when that Markup node is nested under a
  Card.
- `uiMarkupTag` fails with reason `uiMarkupTag "<tag>": Markup tag not found in last render_ui tree`
  when no Markup element has that tag, including a tree with no Markup.
- With no successful `render_ui`, both fail with the existing reason
  `` `<label>: no successful render_ui tree on trace (result.ok, ui present, not skipped)` ``.
- `loadCases` accepts `{"uiText": "x"}` and `{"uiMarkupTag": "strong"}`, and
  refuses `""` or a non-string with `uiText must be a non-empty string` /
  `uiMarkupTag must be a non-empty string`.
- Existing checks behave as before.

## Validation

- `npm test`: passes, including new tests (to add) in
  `server/eval/checks.test.ts` (pass, fail and no-render for each check,
  Markup nested under a Card, case-sensitivity) and
  `server/eval/loadCases.test.ts` (valid strings, empty string and
  non-string refused).
- `npm run typecheck`: passes.
