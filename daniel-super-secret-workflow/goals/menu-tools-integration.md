---
id: menu-tools-integration
priority: 50
depends:
  - menu-actions
  - list-actions-filters
  - render-ui-checks
touches:
  - server/index.ts
  - server/agent/tools/index.ts
  - server/agent/tools/menuTools.test.ts
scope: small
---

# Wire menu dropdown choices into the agent tools and check them end to end

## Sources

- [POS menu actions plan — R8: list_actions filters](../plans/pos-menu-actions.md#r8-list_actions-finds-actions-by-area-and-operation)
- [POS menu actions plan — R9: Dropdown choices](../plans/pos-menu-actions.md#r9-listed-actions-include-dropdown-choices)
- [POS menu actions plan — R12: Dropdown checks](../plans/pos-menu-actions.md#r12-render_ui-checks-dropdowns-against-their-source)
- [POS menu actions plan — Validation](../plans/pos-menu-actions.md#validation)
- [POS menu actions plan — Work breakdown](../plans/pos-menu-actions.md#work-breakdown)

## Context

Three merged goals each delivered one piece, tested with fixtures; this goal
connects them and checks the result with the real menu actions and demo data.

- `menu-actions`: `createMenuActions(menu)` in `server/actions/menu/index.ts`
  returns fourteen menu actions (areas `items`, `sizes`, `prices`,
  `categories`, `modifier_groups`) with dropdown sources `menu_items`,
  `menu_item_sizes`, `menu_categories` and `menu_modifier_groups`.
  `server/index.ts` builds one `createInMemoryPosMenu()` and registers
  `createActionRegistry([...createActions(), ...createMenuActions(menu)])`.
  The registry's `listChoices(source, signal)` loads a source's values.
- `list-actions-filters`: `list_actions` takes required `area` and `operation`
  enums, returns up to 10 matching actions in full plus `others`, and, when
  `createAgentTools` gets `listChoices`, adds `data.choices[source] = { values,
  truncated }`. `createAgentTools({ components, actions, listChoices })` passes
  `listChoices` to `listActionsTool` only.
- `render-ui-checks`: `renderUiTool(components, actions, listChoices?)` loads the
  sources a design's actions use and refuses a non-Select dropdown input or an
  option that isn't a source value (R12), and refuses an `edit` form with no
  input for any optional property (R13).

Still missing: `server/index.ts` calls `createAgentTools({ components, actions:
actions.specs })` without `listChoices`, and `createAgentTools` does not pass
`listChoices` to `renderUiTool`. The plan's R8 examples with the real fourteen
actions and its R9 size check with demo data were left for this goal, because
neither earlier goal had both the menu actions and the new `list_actions`.

## Scope

- `server/agent/tools/index.ts`: pass `listChoices` to `renderUiTool` as well.
- `server/index.ts`: pass `listChoices: actions.listChoices` to
  `createAgentTools` (it must work when called detached from the registry
  object; bind it if the registry uses `this`).
- New `server/agent/tools/menuTools.test.ts`: build the registry from
  `[...createActions(), ...createMenuActions(createInMemoryPosMenu())]`, the
  tools from `createAgentTools({ components: new
  InMemoryComponentRepository(catalog), actions: registry.specs, listChoices:
  registry.listChoices })`, and run them through `createToolRegistry` (so the
  `MAX_RESULT_DATA_CHARS` cap in `server/agent/registry.ts` applies).

## Acceptance

- `list_actions` with the real actions:
  - items + edit returns `menu_update_item` then `menu_set_item_image`;
  - categories + delete returns `menu_delete_category`;
  - prices + edit returns `menu_set_size_price`;
  - items + archive returns `menu_set_item_archived`;
  - items + delete returns the four item actions with `match: "area"`;
  - any + any returns the first 10 actions in full and the other 5 in
    `others`.
- items + edit includes `choices.menu_items` with every demo item name
  (including the archived "Chè ba màu"), sorted by folded name, and
  `choices.menu_categories`; any + any's `data` is returned intact (not replaced
  by the size note), and its JSON is under `MAX_RESULT_DATA_CHARS`.
- `render_ui` through `createAgentTools`: an edit-item form (item Select with
  demo item names, name and description TextInputs, Save with
  `menu_update_item`) renders; the same form with "Latte" among the item
  options is refused with the R12 message; a form with only the item Select and
  Save is refused with the R13 message.
- `server/index.ts` passes `listChoices` to `createAgentTools`.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including the new `server/agent/tools/menuTools.test.ts`.
- `npm run build` and `npm run build:api` succeed.

## After merge

- With `OPENAI_API_KEY` set, ask "Make a form to change a menu item's name and description, with a Save button": the transcript shows `list_actions` with area `items` and operation `edit` before the first `get_component`, the item Select lists the café items, the form has name and description inputs, and Save answers `Updated "…"`.
- No-call check, each in a new chat: "a card showing Bạc xỉu and its price", "what components can I use?", "a login page, just the layout, it doesn't need to work", and after a form is drawn "make the title bigger" and "add a Cancel button" get no `list_actions` call; "A form to update an item's name" still calls it.
- Phrasing check, each in a new chat, noting whether the button gets the expected action within two `list_actions` calls: "tweak a drink's info" (menu_update_item), "change what a large costs" (menu_set_size_price), "take a drink off the menu for now" (menu_set_item_archived), "get rid of a category" (menu_delete_category), "add an extra-large size" (menu_add_size), "let customers pick toppings on a drink" (menu_attach_modifier_group), "new pastry" (menu_create_item), "put a photo on an item" (menu_set_item_image), "đổi giá ly lớn" (menu_set_size_price), "stop offering sugar levels on bạc xỉu" (menu_detach_modifier_group).
- Ask for a form to delete a category: clicking Delete shows the question with Yes and Cancel; Cancel sends nothing; Yes on an empty category deletes it; Yes on "Cà phê" is refused because items use it.
- Restart the API and check that the demo menu is back to the fixtures.
