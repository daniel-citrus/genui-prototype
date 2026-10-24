---
id: agent-guidance
priority: 70
depends:
  - template-each
  - markup-in-designs
  - markup-rules-discovery
  - select-value-lock
touches:
  - server/agent/systemPrompt.ts
  - server/agent/systemPrompt.test.ts
  - server/catalog/components.ts
  - server/catalog/components.test.ts
  - docs/ARCHITECTURE.md
scope: small
---

# Teach the agent Markup in designs, $each, Card forms and locked item Selects

## Sources

- [Component generation plan — R9 Agent guidance matches the new abilities](../plans/data-driven-components-and-card-forms.md#r9-agent-guidance-matches-the-new-abilities)
- [Merged plan — Clarify when to generate a component](../abandoned/custom-component-decision-flow.md#3-clarify-when-to-generate-a-component)

## Context

Earlier goals changed what the tools accept; this one makes the prompt and
catalog descriptions say so, and lands last so the agent is never told about
something the tools still refuse. By the time it runs, the base branch has:

- `template-each`: `{"$each": "<prop>", "as": …}` with `{"$item": true}` /
  `{"$item": "<field>"}` in template and Markup `children` arrays (one level,
  at most 100 items); `define_component`'s `template` description already
  documents it.
- `markup-in-designs`: `render_ui` accepts Markup nodes in the agent's own
  tree, but refuses Markup `input`, `select` and `button` there (templates
  keep them), and hints at a custom component when the tree passes 100 nodes.
- `markup-rules-discovery`: `get_component("Markup")` returns `data.rules`
  with the full allowlist, limits, notes and an example.
- `card-scoped-checks` / `card-scoped-clicks`: a Button sends only the named
  inputs in its nearest Card (or the whole design when it has none); names
  need only be unique within a Card.
- `select-value-lock`: Select takes `value` (an option it starts on) and
  `disabled` (greyed out, still sent).

Current wording to change, in `server/agent/systemPrompt.ts` (`SYSTEM_PROMPT`):

- Step 3: "Only for what nothing existing can draw, define a custom component
  whose template uses Markup."
- Step 5: "Names must be unique in the design."
- Custom components: "Define one with define_component when … or when the
  request needs something no existing component draws. Never define one for a
  single use that existing components already cover." and "Markup may only be
  used inside a template."

In `server/catalog/components.ts`: the Markup entry and its `root` prop say
"Only used inside custom component templates" and describe the rules as
"allowlisted" without listing them; the TextInput, Checkbox and Select `name`
descriptions end "Unique in the design."; Card's description doesn't mention
forms' scope; Select's `value` / `disabled` descriptions are the plain ones
`select-value-lock` added.

`server/agent/systemPrompt.test.ts` pins exact sentences, requires every
registered tool name to appear in the prompt, rejects any snake_case word
that isn't a registered tool (so don't name actions such as the menu update
action in the prompt), and requires the prompt to end with the two retry and
failure rules. The `plain-brief-replies` goal (plain chat plan) also edits
this file: it changes the opening paragraph, step 7, the Rules and the
custom-components reply sentence. If it has merged, build on its wording; if
not, keep this goal's edits to steps 3 and 5 and the Custom components
section so the two merge cleanly.

## Scope

Teach five things, in the system prompt, `define_component`'s descriptions
(check the existing `template` description covers `$each`) and the catalog:

- **When to use Markup:** catalog components when they show what was asked;
  Markup when the person asks for a visual or look they can't produce, such
  as a chart, a rating or a specific style. A rough approximation isn't enough.
- **One-off or reusable:** Markup goes directly in the design for a one-off.
  A component, with `$each` for list data, is for reuse or repeated parts.
- **Forms:** each form goes in its own Card, and names are unique within a Card.
- **Per-item edits:** a form that edits one existing item uses a preset,
  locked item Select.
- **Large lists:** for many repeated forms, use a reusable item card
  component or one form with an item dropdown.

Update the system prompt summary in `docs/ARCHITECTURE.md`.

## Acceptance

- Step 3 replaces "Only for what nothing existing can draw…" with the first
  two rules. Catalog components stay first in the order of preference.
- The Custom components section no longer says "Markup may only be used
  inside a template", and gives one short `$each` example. "Never define one
  for a single use that existing components already cover" stays.
- Step 5 states the form, item-Select and large-list rules, and that Markup
  inputs and buttons only belong in templates. "Names must be unique in the
  design" is gone.
- `define_component`'s `template` description documents `$each`, `as` and
  `$item` with one example.
- In the catalog: the Markup entry no longer says "Only used inside custom
  component templates" and says to call `get_component` for its rules; input
  `name` descriptions say "Unique within its Card"; Card's description says a
  Button sends the inputs inside its Card; Select's `value` and `disabled`
  descriptions explain the item lock.
- `server/agent/systemPrompt.test.ts` and `server/catalog/components.test.ts`
  assert the new wording, and that the old template-only and "nothing
  existing can draw" wording is gone; the prompt and tool names still agree.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including the updated `server/agent/systemPrompt.test.ts`
  and `server/catalog/components.test.ts`.
- `npm run build` and `npm run build:api` succeed.

## After merge

- Run `npm run db:seed` so the catalog descriptions reach the dev database.
- With an OpenAI key and `npm run dev`, ask for "each menu item in its own card with a form to rename it", rename the second item, and confirm in the network tab that only that Card's `item` and `name` were sent and the chat reports the rename.
- Ask for a bar chart of three months and a bullet list of menu items, and check they look right in the sandbox.
