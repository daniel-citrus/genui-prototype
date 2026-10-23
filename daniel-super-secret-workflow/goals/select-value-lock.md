---
id: select-value-lock
priority: 40
depends:
  - card-scoped-clicks
touches:
  - server/catalog/components.ts
  - server/catalog/components.test.ts
  - server/ui/validateTree.ts
  - server/ui/validateTree.test.ts
  - src/sandbox/components.ts
  - docs/ARCHITECTURE.md
scope: small
---

# Let a Select start on an option and be locked

## Sources

- [Component generation plan — R7 Preset and locked Select](../plans/data-driven-components-and-card-forms.md#r7-preset-and-locked-select)
- [Component generation plan — Interfaces](../plans/data-driven-components-and-card-forms.md#interfaces)

## Context

A form that edits one existing item (for example `menu_update_item`, which
requires `item`, a `menu_items` choice) needs to carry which item it edits.
There is no hidden field and no preset value today, so per-item edit Cards
can't visibly fix their item.

This builds on `card-scoped-clicks`, which makes a click send only the named
inputs in the clicked button's nearest Card (paths in `data-path`), and on
`card-scoped-checks` before it, which scoped the server's binding and action
checks per Card.

Current code:

- `server/catalog/components.ts`: the Select entry's `propsSchema` has
  `label`, `options` (strings), `placeholder` and `name`, with
  `additionalProperties: false`. `server/catalog/components.test.ts` asserts
  catalog entries.
- `server/ui/validateTree.ts` validates props against each component's schema
  and runs the binding checks.
- `src/sandbox/components.ts` `Select` renderer draws an optional disabled,
  selected placeholder option, then the options; it sets no initial value and
  no `disabled`.
- `src/main.ts` reads each control's `value` directly (not through form
  submission), so a disabled `select` is still sent; `checkValidity()` passes
  for a disabled control and `isHidden` doesn't treat greyed-out as hidden.
- The server action check (`server/ui/checkAction.ts`) already requires a sent
  Select value to be one of that Select's options.

This goal changes only Select's schema; the later `agent-guidance` goal owns
the wording of catalog descriptions, including these two properties.

## Scope

- Add to Select's `propsSchema.properties`:

  ```ts
  value: { type: "string", description: "The option it starts on; must be one of options." },
  disabled: { type: "boolean", default: false, description: "Shows it greyed out and fixed; its value is still sent." },
  ```

- In `validateTree.ts`, refuse a `value` that isn't one of the Select's
  `options` (`<path>.props.value "<v>" is not one of its options`) and a
  disabled Select without a `value` (`<path> a disabled Select needs a value`).
- In the sandbox `Select` renderer, select `value` when given and set
  `disabled` when true. With `value` set, a `placeholder` option is still
  drawn but not selected.
- Update the Select entry in `docs/ARCHITECTURE.md` if it lists Select props.

The catalog reaches the `components` table through the existing seed (on
start in production, `npm run db:seed` in development); no migration.

## Acceptance

- `{"component": "Select", "props": {"label": "Item", "name": "item", "options": ["Bạc xỉu"], "value": "Bạc xỉu", "disabled": true}}`
  passes validation, renders greyed out showing Bạc xỉu, and a click on its
  Card's action button sends `item: "Bạc xỉu"`.
- `render_ui` refuses a `value` that isn't one of the Select's options, and a
  disabled Select without a `value`, with the messages above.
- With `value` set, a `placeholder` option is still drawn but not selected.
- A Select without `value` or `disabled` behaves as today.
- The server action check is unchanged: a sent Select value must be one of its options.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, with new tests:
  - `server/catalog/components.test.ts`: the Select schema has `value` and `disabled`.
  - `server/ui/validateTree.test.ts`: a value not in the options; a disabled
    Select without a value; a valid preset, locked Select passes.
- `npm run build` and `npm run build:api` succeed.

## After merge

- Run `npm run db:seed`, then `npm run dev`; show a design with a locked Select preset to a menu item and confirm it is greyed out, shows that item, and its value is sent on Save (network tab).
