---
id: list-markup-wording
priority: 50
depends: []
touches:
  - server/agent/systemPrompt.ts
  - server/agent/systemPrompt.test.ts
  - server/catalog/components.ts
  - server/catalog/components.test.ts
scope: small
---

# Say a bullet or numbered list is Markup

## Sources

- [Markup lists and choice selects — R1](../plans/markup-lists-and-choice-selects.md#r1-list-is-markup-in-the-prompt)
- [Markup lists and choice selects — R2](../plans/markup-lists-and-choice-selects.md#r2-markups-catalog-line-names-lists)
- [Markup lists and choice selects — Design](../plans/markup-lists-and-choice-selects.md#design)

## Context

`SYSTEM_PROMPT` in `server/agent/systemPrompt.ts` is prepended by the LLM adapter. The loop does not send it, and it is not stored in history. Step 3 currently says:

```text
Use Markup, which draws a visual from a JSON tree, only when the person asks for a look the components can't produce, such as a chart, a rating or a specific style; a rough approximation with catalog components isn't enough then.
```

The next sentence is `For a one-off, put Markup directly in the design; define a component only for something reused or repeated.` The sentence does not name a list, so the model draws one as Text lines that start with a bullet character. The same step already says a form that edits one existing item has a Select, named after the identifying input, with value set to that item and disabled, and that an input with choices uses a Select. `server/agent/systemPrompt.test.ts` pins the current Markup fragment in "prefers existing components and says when to define one". "names only registered tools in snake_case" treats a snake_case word as a tool name. "teaches forms in Cards, locked item Selects, large lists and $each" and "explains others, choices, optional properties and confirmation" pin the locked-Select sentence and `For an input that has choices, use a Select named after the input, with that source's values as its options.`

Markup's catalog entry in `server/catalog/components.ts` has this description:

```text
Draws allowlisted HTML and SVG elements from a JSON tree, for what no other component can show, such as a bar chart or a star rating. Call get_component for Markup's full rules.
```

`list_components` in `server/agent/tools/components.ts` copies `description` from that entry. `get_component` returns the same `description` and, when the name is Markup, `rules: markupRules()` from `shared/markup.ts`. Those rules already allowlist `ul`, `ol`, and `li`. The root prop description and the SVG `exampleProps` stay as they are. `server/catalog/components.test.ts` "no longer limits Markup to templates and points to its rules" requires `get_component` in the description and rejects `Only used inside custom component templates` in the description and the root description. "describes Markup's root as a JSON tree with kebab-case style keys and $prop values" pins the root description. `server/agent/tools/components.test.ts` "returns Markup's rules, listing every allowlist entry" already requires every tag in `MARKUP_HTML_TAGS`, including `ul`, `ol`, and `li`.

A local eval run `eval-logs/2026-10-24T01-12-26.466Z` (local only) rendered `bullet-list-items` as three Text nodes. This goal does not read or edit that log or the eval case.

## Scope

Replace only the Markup sentence in step 3 of `SYSTEM_PROMPT` with:

```text
Use Markup, which draws a visual from a JSON tree, only when the person asks for a look the components can't produce, such as a chart, a rating, a bullet or numbered list, or a specific style; a rough approximation with catalog components isn't enough then. A bullet or numbered list is Markup with a ul or ol of li elements, not Text lines that start with a bullet character.
```

Leave the following one-off sentence unchanged. Keep the chart, rating, and specific-style examples, and keep Markup limited to a look the catalog cannot produce. Leave the locked-Select sentence and the "for an input that has choices, use a Select" sentence unchanged. `ul`, `ol`, and `li` are tags. Do not add a snake_case word that is not a registered tool.

Replace Markup's `description` with:

```text
Draws allowlisted HTML and SVG elements from a JSON tree, for what no other component can show, such as a bar chart, a star rating, or a bullet or numbered list. Call get_component for Markup's full rules.
```

Do not edit `server/agent/tools/components.ts`, `shared/markup.ts`, Markup's root description, or its SVG example. Do not add a List component, raise `MAX_STEPS`, or edit `server/eval/cases/bullet-list-items.json`. The missing-choice error is a separate goal, `choice-select-error`, and these two goals share no files.

Update "prefers existing components and says when to define one" so it pins the replacement sentence, including `ul` or `ol` of `li` and the refusal of Text lines that start with a bullet character. The old fragment must not stay, or the suite fails. In `server/catalog/components.test.ts`, assert the new description, that it still mentions `get_component`, and that the root description is unchanged.

## Acceptance

- Step 3 of `SYSTEM_PROMPT`, before the custom-component section, contains the replacement sentence above, and the following one-off Markup sentence is unchanged.
- The prompt still contains `A form that edits one existing item has a Select, named after the input that identifies the item, with value set to that item and disabled.` and `For an input that has choices, use a Select named after the input, with that source's values as its options.`
- "names only registered tools in snake_case" passes. The prompt names no unregistered tool. `ul`, `ol`, and `li` are not tool names.
- Markup's catalog `description` is the replacement string above. `list_components` and `get_component` return it because both read that field. Neither tool file changes.
- `get_component` for Markup still returns `markupRules()`, and "returns Markup's rules, listing every allowlist entry" still passes, including `ul`, `ol`, and `li`.
- The description does not say Markup is only for templates. The root description and SVG example are unchanged.

## Validation

- `npm test` exits 0. Database-backed suites skip when `DATABASE_URL` is unset. The tests this goal changes do not need it.
- `npm run typecheck` exits 0.

## After merge

- Run `npm run eval` with `OPENAI_API_KEY` and compare `bullet-list-items` with local log `eval-logs/2026-10-24T01-12-26.466Z` (local only). One run can still miss; the unit tests are the contract.
