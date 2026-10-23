---
id: markup-format-docs
priority: 50
depends: []
touches:
  - server/agent/tools/customComponents.ts
  - server/agent/tools/customComponents.test.ts
  - server/catalog/components.ts
  - server/catalog/components.test.ts
scope: small
---

# Show Markup's root format where the model writes templates

## Sources

- [Eval follow-ups — R3: Describe Markup's root format in define_component](../plans/eval-followups.md#r3-describe-markups-root-format-in-define_component)
- [Eval follow-ups — R4: Describe $prop and style keys in Markup's root description](../plans/eval-followups.md#r4-describe-prop-and-style-keys-in-markups-root-description)
- [Eval follow-ups — Interfaces](../plans/eval-followups.md#interfaces)

## Context

In an eval run (`npm run eval -- --repeat 3` on main `84ee2fa`), every
attempt of `price-tag`, `markup-prop-text` and `markup-bold-tag` began with
a `define_component` call whose Markup props were an HTML string (`markup`
or `html`). Each was refused with `template.props.root is required (call
get_component Markup for its props)` and `template.props.<key> is not
allowed`, costing a retry. None had read `get_component Markup` first. After
reading it, the model still hit camelCase style keys (`alignItems`), a
`style` string inside `attrs`, and the `b` tag.

Current code:

- `defineComponentTool` in `server/agent/tools/customComponents.ts`: the
  `template` input property's description explains `{"$prop": "<name>"}` and
  `{"$children": true}` and ends with "text such as {{name}} is shown as
  written, never filled in." It does not describe Markup's props. Tests in
  `server/agent/tools/customComponents.test.ts` do not assert description
  text; they save definitions through the tool with an
  `InMemoryCustomComponentRepository` (see "saves a valid definition as v1,
  then as v2"). `withTemplate` in `server/customComponents/testDefinitions.ts`
  builds a definition with an empty `propsSchema`, so a test using a `label`
  prop must set `propsSchema` and `exampleProps` itself.
- The `Markup` entry in `server/catalog/components.ts` has
  `propsSchema.properties.root.description`: "The root element: { "tag",
  "attrs"?, "style"?, "text"?, "action"?, "children"? }, with allowlisted
  tags, attributes and inline style properties; no scripts, classes or event
  handlers. Only used inside custom component templates." It does not
  mention `$prop` or the style key format.
- `validateCatalog` (`server/catalog/validate.ts`, tests in
  `server/catalog/validate.test.ts`) requires a description on every
  property. There is no `server/catalog/components.test.ts` yet.
- Markup rules are in `shared/markup.ts` (`MARKUP_HTML_TAGS` includes `span`
  and `strong`; `MARKUP_STYLE_PROPERTIES` are kebab-case). `checkTemplate`
  in `server/customComponents/definition.ts` accepts `{"$prop"}` for an
  element's `text` and each `attrs` and `style` value.
- The system prompt keeps catalog contents out on purpose, so this format
  goes in tool and catalog descriptions only, not in
  `server/agent/systemPrompt.ts`.

## Scope

1. Append exactly this text (it starts with a space) to the end of the
   `template` property description in `defineComponentTool`, after "never
   filled in.". The rest of that description and the tool's top-level
   `description` stay unchanged:

   ```text
    Markup takes one prop, root: a JSON element {"tag", "attrs"?, "style"?, "text"?, "children"?}, never an HTML string. Its text, attribute and style values may be {"$prop": "<name>"}. Style keys are kebab-case CSS properties, such as font-weight, and go in style, not attrs. Example: {"component": "Markup", "props": {"root": {"tag": "span", "children": [{"tag": "strong", "text": {"$prop": "label"}}]}}}.
   ```

2. Replace the Markup `propsSchema.properties.root.description` in
   `server/catalog/components.ts` with exactly:

   ```text
   The root element: { "tag", "attrs"?, "style"?, "text"?, "action"?, "children"? }, a JSON tree, never an HTML string, with allowlisted tags, attributes and inline style properties; no scripts, classes or event handlers. Style keys are kebab-case CSS properties, such as font-weight, and go in style, not attrs. In a template, text, attribute and style values may be {"$prop": "<name>"}. Only used inside custom component templates.
   ```

Constraints: the texts name only allowlisted things (`span`, `strong`,
`font-weight`) and change no rule; `sanitizeMarkup`, `validateDefinition`
and `shared/markup.ts` are untouched. The Markup `exampleProps` stay as they
are. Out of scope: a targeted error for Markup HTML strings, listing the
full tag and style allowlist, and new eval cases.

## Acceptance

- The `define_component` `template` description ends with the exact text in
  Scope step 1; the rest of it and the tool's `description` are unchanged.
- The example in that text is valid JSON, and a definition whose template is
  that example, with a declared string prop `label` and `exampleProps`
  `{ "label": "New" }`, saves through `define_component` as v1.
- The Markup `root` description is exactly the text in Scope step 2.
- `validateCatalog(catalog)` still returns no problems, and the Markup
  `exampleProps` are unchanged.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including tests this goal adds: in
  `server/agent/tools/customComponents.test.ts`, the `template` description
  contains `never an HTML string`, `{"$prop": "<name>"}` and `kebab-case`,
  and the example (parsed from the description) saves as v1; in a new
  `server/catalog/components.test.ts`, the Markup `root` description contains
  `never an HTML string`, `kebab-case` and `{"$prop": "<name>"}`, and
  `validateCatalog(catalog)` returns no problems. Database and Redis tests
  skip without `DATABASE_URL` and `REDIS_URL`.
- `npm run build` and `npm run build:api` succeed.

## After merge

- In development, run `npm run db:seed` so the new Markup description reaches the `components` table (production reseeds on start).
- With `OPENAI_API_KEY` set, run `npm run eval -- --repeat 3`; in its run directory, `grep -l 'template.props.root is required' price-tag.*.json markup-prop-text.*.json markup-bold-tag.*.json` lists no files.
- Compare `promptTokens` for `price-tag` and `markup-prop-text` in that run with `eval-logs/2026-10-23T10-47-35.373Z` (local only).
