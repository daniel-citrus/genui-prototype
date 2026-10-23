---
id: markup-in-designs
priority: 20
depends: []
touches:
  - server/agent/tools/ui.ts
  - server/agent/tools/ui.test.ts
  - docs/ARCHITECTURE.md
scope: small
---

# Allow visual-only Markup directly in render_ui designs

## Sources

- [Component generation plan — R3 Markup in designs](../plans/data-driven-components-and-card-forms.md#r3-markup-in-designs)
- [Component generation plan — R14 Markup in designs is for visuals only](../plans/data-driven-components-and-card-forms.md#r14-markup-in-designs-is-for-visuals-only)
- [Component generation plan — R15 Node-limit hint](../plans/data-driven-components-and-card-forms.md#r15-node-limit-hint)

## Context

Markup is the only way to draw things like a bullet, a bar or a star, but
today it may only appear inside a saved custom component. In a real trace the
agent's `render_ui` with a Markup `ul` was refused ("Markup can only be used
inside a custom component"), forcing a global saved component for a one-off
visual. The template-only rule isn't a security boundary: a template with
Markup `root: {"$prop": "root"}` and a `root: {type: "object"}` prop already
passes `validateDefinition`, so a design can pass any Markup tree through a
saved component. The sanitizer is the boundary.

Current code:

- `server/agent/tools/ui.ts` `ownTreeProblems` walks the agent's own tree
  (custom nodes count as one node), pushes
  `<path> Markup can only be used inside a custom component; define one with define_component`
  for every Markup node, and returns `sizeProblems(stats)` (100 nodes,
  8 levels) for that tree.
- `server/ui/validateTree.ts` `sizeProblems(stats, maxNodes, maxDepth)` is
  shared with the expanded-tree check (400 nodes), and `validateUiTree`
  already validates every Markup root it meets with `sanitizeMarkup`
  (`shared/markup.ts`, via `server/ui/markup.ts` `validateMarkup`). Each root
  is capped at 200 elements and 12 levels; Markup can't set `data-*`.
- `server/agent/tools/ui.test.ts` pins the refusal in "refuses Markup in the
  agent's own tree, even when it is valid", and has a Markup form case (a
  custom component whose template holds a Markup `input` and `button`,
  around line 280) that must keep rendering.

No prerequisites. `template-each` adds separate `it` blocks to
`server/agent/tools/ui.test.ts`; keep yours separate. The system prompt still
says Markup belongs in templates until the later `agent-guidance` goal
rewrites it; don't edit the prompt or catalog descriptions here.

## Scope

In `ownTreeProblems`:

- Drop the blanket Markup refusal. Markup nodes in the agent's tree are then
  checked by the same `sanitizeMarkup` rules as in templates.
- Walk each Markup node's `props.root` (at any depth of Markup `children`) and
  refuse `input`, `select` and `button` elements:
  `<path> Markup input can't be used directly in a design; use TextInput, Checkbox, Select or Button, or put it in a custom component template`
  (with `select` / `button` in place of `input` as appropriate). Forms in
  designs then always use catalog components; templates keep Markup controls.
- Replace the own-tree node-count problem with
  `tree has <n> nodes (max 100); put the repeated part in a custom component, where each use counts as one node`.
  Leave `sizeProblems` and the expanded-tree (400 nodes) message unchanged;
  the depth message is also unchanged.

Update the `render_ui` section of `docs/ARCHITECTURE.md`.

## Acceptance

- `render_ui` with `{"component": "Markup", "props": {"root": {"tag": "ul", "children": [{"tag": "li", "text": "A"}]}}}`
  renders, with no `define_component` call.
- A Markup node in the agent's tree that breaks the allowlist is refused with
  the same messages as in a template, and nothing is shown: for example a
  `script` tag, `attrs.onclick`, `style.position` or a `javascript:` value.
- The agent's tree size limits (100 nodes, 8 levels) still count each Markup
  node as one node; each Markup root keeps its 200-element and 12-level limits.
- A design with a Markup node whose root holds an `input` at any depth is
  refused with the message above; the same for `select` and `button`.
- A custom component whose template has a Markup form (the existing
  `ui.test.ts` Markup form case) still renders.
- A 101-node agent tree gets the node-limit message with the hint. The
  expanded-tree limit message (400 nodes) is unchanged.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, with `server/agent/tools/ui.test.ts` changed to: replace
  "refuses Markup in the agent's own tree" with "renders Markup in the agent's
  own tree"; add refusals for `script` and `attrs.onclick`; add refusals for
  Markup `input`, `select` and `button` in the agent's tree; keep the template
  Markup form case passing; add a 101-node tree that gets the hint.
- `npm run build` and `npm run build:api` succeed.
