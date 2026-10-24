---
id: markup-rules-discovery
priority: 40
depends:
  - template-each
touches:
  - shared/markup.ts
  - server/agent/tools/components.ts
  - server/agent/tools/components.test.ts
  - docs/ARCHITECTURE.md
scope: small
---

# Return Markup's allowlist from get_component("Markup")

## Sources

- [Component generation plan — R12 Markup rules from get_component](../plans/data-driven-components-and-card-forms.md#r12-markup-rules-from-get_component)
- [Component generation plan — Interfaces](../plans/data-driven-components-and-card-forms.md#interfaces)

## Context

`get_component("Markup")` returns only `propsSchema` and `exampleProps`. The
Markup catalog entry says its tags and styles are "allowlisted" without
listing them, so the agent guesses. An eval log shows a StatusDot component
needing three `define_component` attempts, failing on `display: inline-flex`
and on `attrs.style`.

`shared/markup.ts` holds what the validator (`sanitizeMarkup`) accepts:

- exported: `MARKUP_HTML_TAGS` (tag → attributes, each list starting with the
  common `title` and `aria-label` via the private `html(...)` helper),
  `MARKUP_SVG_TAGS`, `MARKUP_STYLE_PROPERTIES`, `MARKUP_DISPLAY_VALUES`,
  `MARKUP_INPUT_TYPES`, `MARKUP_FUNCTIONS`, and the limits
  `MAX_MARKUP_ELEMENTS` (200), `MAX_MARKUP_DEPTH` (12),
  `MAX_MARKUP_TEXT_CHARS` (1000), `MAX_MARKUP_VALUE_CHARS` (200);
- module-private: `UNSAFE_VALUE_PARTS`, `BOOLEAN_ATTRIBUTES` and `NO_TEXT_TAGS`.

`server/agent/tools/components.ts` implements `get_component`. The registry
(`server/agent/registry.ts`) replaces any result whose `data` exceeds
`MAX_RESULT_DATA_CHARS` (16,384 characters) with a truncation note.

This builds on `template-each`, which adds the `$each` / `as` / `$item`
template syntax and the `isEachEntry` / `isItemPlaceholder` helpers to
`shared/markup.ts`; the notes here document that syntax. Leave catalog
descriptions to the later `agent-guidance` goal.

## Scope

Add to `shared/markup.ts`, built from the module's own constants so the rules
can't drift from validation:

```ts
export interface MarkupRules {
  htmlTags: Record<string, readonly string[]>; // attributes beyond commonAttributes
  commonAttributes: readonly string[];
  svgTags: Record<string, readonly string[]>;
  styleProperties: readonly string[];
  displayValues: readonly string[];
  inputTypes: readonly string[];
  functions: readonly string[];
  forbiddenInValues: readonly string[];
  booleanAttributes: readonly string[];
  noTextTags: readonly string[];
  limits: { elements: number; depth: number; textChars: number; valueChars: number };
  notes: readonly string[];
  example: MarkupElement;
}
export function markupRules(): MarkupRules;
```

`get_component` adds `markupRules()` as `data.rules` when the name is
`Markup`; other components' results are unchanged. Update the
`get_component` description in `docs/ARCHITECTURE.md`. Don't change what the
sanitizer accepts.

## Acceptance

- `get_component("Markup")`'s `data.rules` lists:
  - the HTML tags, with their attributes beyond the common `title` and `aria-label`;
  - the SVG tags with their attributes;
  - the style properties, the `display` values, the `input` types, and the
    functions values may call;
  - the substrings values must not contain, the boolean attributes, and the
    tags that take no `text`;
  - the limits (200 elements, 12 levels, 1,000 text characters, 200
    characters per value).
- It also gives short notes (style keys are kebab-case and go in `style`;
  `img src` must be http(s); no `position`, `z-index` or CSS `transform`), the
  `{"$prop"}`, `$each` and `$item` syntax, and one valid example element
  that `sanitizeMarkup` accepts.
- A test fails if any allowlisted tag, attribute, style property, display
  value, input type or function is missing from `rules`.
- The whole result is under `MAX_RESULT_DATA_CHARS`, so the registry doesn't
  replace it with a truncation note.
- Other components' `get_component` results have no `rules` and are otherwise
  unchanged.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, with new cases in `server/agent/tools/components.test.ts`:
  every allowlist entry appears in `rules`; the example passes
  `sanitizeMarkup`; the serialized result is under `MAX_RESULT_DATA_CHARS`;
  other components have no `rules`.
- `npm run build` and `npm run build:api` succeed.
