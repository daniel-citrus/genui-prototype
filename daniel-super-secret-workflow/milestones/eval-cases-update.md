---
id: eval-cases-update
priority: 50
depends:
  - eval-text-checks
  - eval-repeat
touches:
  - server/eval/cases/export-pdf.json
  - server/eval/cases/price-tag.json
  - server/eval/cases/markup-bold-tag.json
  - server/eval/cases/markup-prop-text.json
  - server/eval/cases/custom-props-shown.json
  - server/eval/cases/sms-no-action.json
  - server/eval/cases/newsletter-no-action.json
  - server/eval/cases/invented-action-name.json
  - server/eval/cli.test.ts
scope: small
---

# Reword export-pdf, make price-tag check the drawn price, and add six eval cases

## Sources

- [Eval findings fixes — R8, R9, R10](../plans/eval-findings-fixes.md#r8-reword-export-pdf)

## Context

Eval cases are JSON files `{"id", "prompt", "checks"}` in
`server/eval/cases/`, loaded by `loadCases` (`server/eval/loadCases.ts`):
ids must be kebab-case and unique, prompts at most `MAX_MESSAGE_CHARS`
(4000) characters, and cases are returned sorted by id. There are 14 today.
`server/eval/cli.test.ts` holds a `committedCases: EvalCase[]` array that
must deep-equal `loadCases` on that directory ("loads all committed cases
sorted by id"), so every case change also edits that array.

This builds on `eval-text-checks`, which adds the `{"uiText": "<text>"}` and
`{"uiMarkupTag": "<tag>"}` checks to `EvalCheck` and `loadCases` (without it
the new cases fail to load), and comes after `eval-repeat`, which also edits
`server/eval/cli.test.ts`.

- `export-pdf`: the prompt "Show a button labeled Export PDF. It should run
  a server action, but only if one of the registered actions actually
  exports a PDF." reads as a condition on the whole button, so the model
  replied without rendering. The system prompt says to render a button
  without an action when none fits and say clicking it does nothing yet.
- `price-tag`: its checks never look at what is drawn, so a template that
  showed the literal `{{props.price}}` passed.
- The registered actions in eval are `demo_echo` and the café menu actions
  (`server/eval/runner.ts` wires `createActions` and `createMenuActions`);
  none sends SMS, manages a mailing list or exports CSV, and there is no
  `export_csv` action.

## Scope

Check shorthand below: `toolSucceeded X` means `{"toolSucceeded": "X"}`,
`noButtonAction` means `{"noButtonAction": true}`, and so on.

- `server/eval/cases/export-pdf.json`: prompt becomes
  `Show a button labeled Export PDF that exports this page as a PDF.`;
  checks unchanged: `endedBy reply`, `noError true`, `toolCalled list_actions`,
  `toolSucceeded render_ui`, `uiComponent Button`, `noButtonAction true`.
- `server/eval/cases/price-tag.json`: prompt becomes
  `Define a custom component named PriceTag that uses Markup to draw a label no catalog component can: a span whose text is the price prop in bold. Then show PriceTag with the price $12.99. Use Markup in the template.`;
  checks are the existing six (`endedBy reply`, `noError true`,
  `toolSucceeded define_component`, `toolSucceeded render_ui`,
  `agentComponent PriceTag`, `uiComponent Markup`) followed by
  `{"uiText": "$12.99"}`.
- Six new files. Each has `{"endedBy": "reply"}` and `{"noError": true}` as
  its first two checks, then the listed checks in order, and the id equals
  the file name without `.json`:

| File | Prompt | Checks after endedBy and noError |
|---|---|---|
| `markup-bold-tag.json` | Define a custom component named SaleLabel that uses Markup to draw the word SALE in a b tag inside a span. Then show SaleLabel. | `toolSucceeded define_component`, `toolSucceeded render_ui`, `agentComponent SaleLabel`, `uiMarkupTag strong`, `uiText SALE` |
| `markup-prop-text.json` | Define a custom component named StatusDot that uses Markup: an svg with a small green circle, then a span whose text is a label prop. Then show StatusDot with the label Online. | `toolSucceeded define_component`, `toolSucceeded render_ui`, `agentComponent StatusDot`, `uiMarkupTag circle`, `uiText Online` |
| `custom-props-shown.json` | Define a reusable custom component named ContactCard: a Card with a Heading showing a name prop and a Text showing an email prop. Then show ContactCard for Ada Lovelace, ada@example.com. | `toolSucceeded define_component`, `toolSucceeded render_ui`, `agentComponent ContactCard`, `uiComponent Card`, `uiText Ada Lovelace`, `uiText ada@example.com` |
| `sms-no-action.json` | Add a button labeled Send SMS that texts the customer their order status. | `toolCalled list_actions`, `toolSucceeded render_ui`, `uiComponent Button`, `noButtonAction` |
| `newsletter-no-action.json` | Show a newsletter signup: an email field and a Subscribe button that adds the person to our mailing list. | `toolCalled list_actions`, `toolSucceeded render_ui`, `uiComponent TextInput`, `uiComponent Button`, `noButtonAction` |
| `invented-action-name.json` | Show a Download CSV button that runs the export_csv action. | `toolCalled list_actions`, `toolSucceeded render_ui`, `uiComponent Button`, `noButtonAction` |

- `server/eval/cli.test.ts`: update `committedCases` to the 20 cases, sorted
  by id, matching the files exactly. Leave the rest of the file as
  `eval-repeat` left it.

Use only the reserved `example.com` domain and the historical name Ada
Lovelace; no real contact details.

## Acceptance

- `loadCases("server/eval/cases")` loads 20 cases without errors, sorted by
  id, and deep-equals `committedCases` in `server/eval/cli.test.ts`.
- `export-pdf.json` and `price-tag.json` have exactly the prompts and checks
  above.
- Each new case has the prompt and checks in the table, with `endedBy reply`
  and `noError true` first.
- Every prompt is within `MAX_MESSAGE_CHARS`, and every id is kebab-case,
  unique and equal to its file name.

## Validation

- `npm test`: passes, including "loads all committed cases sorted by id" in
  `server/eval/cli.test.ts`.
- `npm run typecheck`: passes.

## After merge

- With `OPENAI_API_KEY` set, run `npm run eval -- --repeat 3` and confirm `price-tag` passes `uiText "$12.99"`; note any case under 3/3 as flaky.
- If `markup-bold-tag` fails only on `uiMarkupTag strong` because the model drew bold with `font-weight`, replace that check with `uiText SALE` alone and note it.
- If `export-pdf`, `sms-no-action`, `newsletter-no-action` or `invented-action-name` still reply without rendering, open a follow-up on the system prompt's no-fitting-action rule.
