---
id: custom-components-docs
priority: 90
depends:
  - custom-component-agent-tools
  - custom-components-panel
touches:
  - docs/ARCHITECTURE.md
scope: small
---

# Describe custom components in the architecture doc

## Sources

- [Custom components plan: R15 and the whole plan](../plans/custom-components.md#r15-documentation)

## Context

By the time this runs, the code has custom components end to end:
- **Storage:** `custom_components` and `custom_component_versions` tables behind `CustomComponentRepository`, with versions kept and deletes soft. The seed doesn't touch them.
- **Markup:** a `Markup` catalog component for allowlisted HTML and SVG, used only inside templates.
- **Validation and expansion:** `validateDefinition` and `expandTree` in `server/customComponents/`.
- **render_ui:** it expands custom components before validating, and sends and remembers only the expanded tree.
- **Agent tools:** `define_component` and `delete_component`, and custom components in `list_components` and `get_component`.
- **Panel:** the `/api/custom-components` route and the browser's Components panel.
- **Prompt:** the system prompt's order of preference.

`docs/ARCHITECTURE.md` still describes a fixed 12-component catalog. Document what the code does, not the plan's wording; read the merged code where they differ.

## Scope

Update `docs/ARCHITECTURE.md`:
- **§1:** the architecture diagram gains the custom components route, the expander and the new tables.
- **§2:** the Components panel, and the sandbox drawing `Markup`.
- **§3:**
  - **Agent row:** the new tools and arguments.
  - **Ports:** `CustomComponentRepository`.
  - **Catalog:** `Markup` and its allowlist.
  - **New row:** for `server/customComponents/` and the `/api/custom-components` route.
- **§4:**
  - `render_ui` expanding before validation, the expanded limits (400 nodes, 24 levels), and error paths that name the custom component and version;
  - definition rules and limits: name pattern, 300-character description, 8,000-character definition, 40 nodes and 6 levels per template, 3 levels of nesting, 200 elements and 12 levels per Markup root;
  - the system prompt's order of preference, and the rule that only registered actions may be used.
- **§5:** the two tables, versioning, soft delete, restore and revert, the limits (200 active, 500 total, 20 versions), and that the seed never touches them.
- **§8 and §10:** the new folders. §10 no longer says the `components` table is the only component data. It lists the new limits and that custom components are global.

## Acceptance

- Each section named in Scope describes the merged behavior, with links to the new files that resolve.
- No statement contradicts the code: every file, function, tool, route and limit named exists with that name and value (check with grep).
- The Mermaid diagram keeps the existing syntax style.

## Validation

- `npm run typecheck` and `npm test` pass (no code changes expected).
- Every repository path linked from the changed text exists (check with `test -e` on each).

## After merge

- Read §1 to §5 and §10 against the running app and check they match what you see.
