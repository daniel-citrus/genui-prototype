---
id: menu-actions
priority: 30
depends:
  - pos-menu-port
  - action-spec-confirmation
touches:
  - server/actions/menu/index.ts
  - server/actions/menu/resolve.ts
  - server/actions/menu/money.ts
  - server/actions/menu/choices.ts
  - server/actions/menu/menu.test.ts
  - server/actions/menu/resolve.test.ts
  - server/actions/menu/money.test.ts
  - server/index.ts
scope: large
---

# Register fourteen menu actions over the demo menu

## Sources

- [POS menu actions plan — R4: Menu actions](../plans/pos-menu-actions.md#r4-menu-actions)
- [POS menu actions plan — R5: Names and values](../plans/pos-menu-actions.md#r5-menu-actions-resolve-names-and-parse-values)
- [POS menu actions plan — R9: Dropdown choices](../plans/pos-menu-actions.md#r9-listed-actions-include-dropdown-choices)
- [POS menu actions plan — Interfaces](../plans/pos-menu-actions.md#interfaces)
- [POS menu actions plan — Errors and edge cases](../plans/pos-menu-actions.md#errors-and-edge-cases)

## Context

Today the only action a generated Button can run is `demo_echo`. This goal adds
fourteen menu actions so a generated form can change the café menu.

It builds on two merged goals:

- `pos-menu-port` provides `server/ports/PosMenu.ts` (the `PosMenu` interface
  mirroring CapheVietPOS's `MenuStore`, its `Money`, `Item`, `Variation`,
  `Category`, `ModifierGroup` and input types, and `PosMenuError` with `code`
  `"validation"` or `"not_found"`), `createInMemoryPosMenu()` in
  `server/adapters/pos/InMemoryPosMenu.ts` (a private copy of the café demo
  menu: 4 categories, 3 modifier groups, 7 items, one archived), and
  `cleanName`, `foldName` and `sizeLabel` in `server/text/names.ts`
  (`sizeLabel("Bạc xỉu", "L")` is `"Bạc xỉu (L)"`).
- `action-spec-confirmation` adds optional `area`, `operation` (one of
  `ACTION_OPERATIONS`), `choices` and `confirm` to `ActionSpec`/
  `ActionDefinition` in `server/actions/types.ts`. A definition's `choices` maps
  an input name to a `ChoiceSource` (`{ name, list(signal) }`); the registry
  validates the fields, exposes source names in `specs`, and loads values via
  `registry.listChoices(source, signal)`. The action route asks the `confirm`
  question (filling `{property}` placeholders) before running an action that has
  one.

The registry (`server/actions/registry.ts`) checks values against each closed
`input_schema` before `run`, applies a timeout, turns a throw into `{ ok:
false, message: "That action failed." }` and logs it. `MAX_FIELD_CHARS` (1000)
is in `shared/api.ts`. `demo_echo` in `server/actions/demo.ts` shows the
definition style. Values come from the sandbox: a text field sends its text, a
Select sends its option text (`""` on the placeholder), a Checkbox sends a
boolean, and an input missing from the design sends nothing.

## Scope

`server/actions/menu/index.ts` exports `createMenuActions(menu: PosMenu):
ActionDefinition[]`, returning these actions in this order (`*` = required;
dropdown sources: item → `menu_items`, size → `menu_item_sizes`, category →
`menu_categories`, group → `menu_modifier_groups`):

| Action | area / operation | Inputs | PosMenu calls | confirm |
|---|---|---|---|---|
| `menu_create_item` | items / create | name\*, size\*, price\*, description, category | `listCategories`, `createItem` | - |
| `menu_update_item` | items / edit | item\*, name, description, category | `listItems`, `listCategories`, `updateItem` | - |
| `menu_set_item_archived` | items / archive | item\*, archived\* (boolean) | `listItems`, `setItemArchived` | - |
| `menu_set_item_image` | items / edit | item\*, image_url | `listItems`, `setItemImage` | - |
| `menu_attach_modifier_group` | modifier_groups / attach | item\*, group\* | `listItems`, `listModifierGroups`, `updateItem` | - |
| `menu_detach_modifier_group` | modifier_groups / detach | item\*, group\* | `listItems`, `listModifierGroups`, `updateItem` | - |
| `menu_add_size` | sizes / create | item\*, name\*, price\* | `listItems`, `addVariation` | - |
| `menu_update_size` | sizes / edit | size\*, name, sku | `listItems`, `updateVariation` | - |
| `menu_set_size_price` | prices / edit | size\*, price\* | `listItems`, `setVariationPrice` | - |
| `menu_remove_size` | sizes / delete | size\* | `listItems`, `removeVariation` | Remove the size {size}? This can't be undone. |
| `menu_create_category` | categories / create | name\* | `createCategory` | - |
| `menu_rename_category` | categories / edit | category\*, name\* | `listCategories`, `renameCategory` | - |
| `menu_delete_category` | categories / delete | category\* | `listCategories`, `deleteCategory` | Delete the category {category}? This can't be undone. |
| `menu_delete_modifier_group` | modifier_groups / delete | group\* | `listModifierGroups`, `deleteModifierGroup` | Delete the modifier group {group}? This can't be undone. |

- Every input named `item`, `size`, `category` or `group` takes its values from
  the matching dropdown source, except `menu_create_item`'s `size`, which is the
  new size's name as free text. `menu_create_item` creates an item with exactly
  one size; `menu_add_size`'s `name` is the new size's name.
- Every input schema is closed (`additionalProperties: false`), has only string
  or boolean properties, each with a `description`, and declares the required
  inputs above in `required`. Names (`name`, `item`, `category`, `group`, and
  `menu_create_item`'s `size`) have `maxLength: 100`; other text (`size` labels,
  `description`, `price`, `sku`, `image_url`) has `maxLength: MAX_FIELD_CHARS`.
  Each action's `description` says what it does and which inputs it reads.
- `server/actions/menu/choices.ts` builds the four sources once per
  `createMenuActions` call; actions using the same source share the same object.
  Values, each sorted by `foldName` (stable for ties): `menu_items` every item
  name, archived ones too; `menu_item_sizes` `sizeLabel(item, size)` for every
  size of every item; `menu_categories`; `menu_modifier_groups`.
- `server/actions/menu/resolve.ts`: `item`, `category` and `group` resolve by
  exact name first, then by a unique match after `foldName`. `size` is one
  "Item (Size)" label resolved the same way against every size of every item.
  Name lookups use `listItems({ includeArchived: true })`. No match answers
  `No item named "X". Ask the agent to show the form again.` (likewise `No size
  named`, `No category named`, `No modifier group named`). Several matches answer
  with all the matching names and ask the person to rename one.
- An empty value for a required `item`, `size`, `category` or `group` answers
  `Choose an item first.` (or `a size`, `a category`, `a modifier group`), and
  the menu is not called.
- `server/actions/menu/money.ts`: `export function parsePrice(text: string):
  Money | null` accepts `4`, `4.5`, `4.50` and `$4.50` (like CapheVietPOS's
  `parseMoney`: trim, drop `$` and `,`, then `^\d+(\.\d{1,2})?$`, rounded to USD
  cents); anything else answers `Price must look like 4.50.` `export function
  formatPrice(money: Money): string` gives `$4.50`.
- An empty or missing optional text field or Select means "leave unchanged".
  `menu_update_item` and `menu_update_size` with nothing to change answer
  `Nothing to change: fill in at least one field.` `menu_set_item_image` with
  an empty or missing `image_url` clears the image.
- `menu_attach_modifier_group` when the item already offers the group, and
  `menu_detach_modifier_group` when it doesn't, answer `ok: true` saying nothing
  changed.
- A `PosMenuError` becomes `{ ok: false, message: err.message }`. Any other
  error is rethrown, so the registry answers `That action failed.` and logs it.
- Each success message says what changed and names the item, size, category or
  group, for example `Updated "Bạc xỉu": name, description.`
- `server/index.ts`: build one `createInMemoryPosMenu()` and register
  `createActionRegistry([...createActions(), ...createMenuActions(menu)])`.
  Leave `server/actions/index.ts` and the `createAgentTools` call unchanged;
  `menu-tools-integration` passes `listChoices` to the tools later.

## Acceptance

- `createActionRegistry([...createActions(), ...createMenuActions(createInMemoryPosMenu())])`
  does not throw, and its `specs` list `demo_echo` then the fourteen actions in
  table order, each with the area, operation, choices and confirm above.
- Each action's happy path against a fresh demo menu changes the menu as named
  and returns its message; for example `menu_set_size_price` with `Bạc xỉu (L)`
  and `$6` makes that size 600 cents.
- Name resolution: exact, folded (`bac xiu` finds `Bạc xỉu`), missing and
  ambiguous names and size labels give the results above.
- Empty required dropdown values, invalid prices, nothing-to-change, image
  clearing and attach/detach no-ops give the results above; deleting `Cà phê`
  (in use) and removing an item's last size answer `ok: false` with the
  adapter's reason.
- A fake `PosMenu` method throwing a plain `Error` gives `That action failed.`
  through the registry.
- Each source's values and order match the demo menu, including "Item (Size)"
  labels.
- A sample edit-item tree (an item Select whose options are demo item names,
  name and description TextInputs, a category Select whose options are demo
  category names, and a Save Button with `action: "menu_update_item"`) passes
  `validateUiTree(tree, components, registry.specs)` (`server/ui/validateTree.ts`;
  get `components` from `new InMemoryComponentRepository(catalog).list()`, as
  `server/ui/validateTree.test.ts` does), and a click on it passes
  `checkActionRequest` (`server/ui/checkAction.ts`).

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including the new `server/actions/menu/menu.test.ts`,
  `server/actions/menu/resolve.test.ts` and
  `server/actions/menu/money.test.ts`.
- `npm run build:api` succeeds.
