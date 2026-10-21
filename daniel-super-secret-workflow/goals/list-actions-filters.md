---
id: list-actions-filters
priority: 30
depends:
  - action-spec-confirmation
touches:
  - server/agent/tools/actions.ts
  - server/agent/tools/actions.test.ts
  - server/agent/tools/index.ts
  - server/agent/systemPrompt.ts
  - server/agent/systemPrompt.test.ts
scope: medium
---

# Filter list_actions by area and operation, with dropdown choices

## Sources

- [POS menu actions plan — R8: list_actions filters](../plans/pos-menu-actions.md#r8-list_actions-finds-actions-by-area-and-operation)
- [POS menu actions plan — R9: Dropdown choices](../plans/pos-menu-actions.md#r9-listed-actions-include-dropdown-choices)
- [POS menu actions plan — R10: System prompt](../plans/pos-menu-actions.md#r10-the-system-prompt-teaches-the-filters)
- [POS menu actions plan — Interfaces](../plans/pos-menu-actions.md#interfaces)

## Context

The agent (an OpenAI tool loop) builds UIs from a component catalog and can wire
a Button to a registered server action. Its tools come from
`createAgentTools({ components, actions })` in `server/agent/tools/index.ts`:
`list_components`, `get_component`, `list_actions` and `render_ui`.
`list_actions` (`server/agent/tools/actions.ts`, `listActionsTool(actions)`)
takes no arguments and returns every spec as `{ name, description,
input_schema }`. The tool registry (`server/agent/registry.ts`) validates
arguments against each tool's `input_schema` (an invalid call gets
`Invalid arguments for <tool>` with the errors) and replaces `data` over
`MAX_RESULT_DATA_CHARS` (16,384 characters) with a note. Tool handlers get
`ctx.signal` and `ctx.log` (`server/agent/tools.ts`).

This builds on `action-spec-confirmation`, which adds optional `area`,
`operation` (one of `ACTION_OPERATIONS`: `create`, `edit`, `archive`, `delete`,
`attach`, `detach`, `other`), `choices` (input name → dropdown source name) and
`confirm` to `ActionSpec` in `server/actions/types.ts`, and
`ActionRegistry["listChoices"]` (`(source, signal) => Promise<string[]>`).

A parallel goal, `menu-actions`, registers fourteen menu actions; this goal
must not depend on them, so test with fixture specs and a fake `listChoices`.
`menu-tools-integration` later passes the real `actions.listChoices` in
`server/index.ts` and re-checks the examples below against the real menu
actions; `server/index.ts` is not part of this goal.

`server/agent/systemPrompt.ts` holds `SYSTEM_PROMPT`. Its step 2 is "Choose the
components you need", and step 4 says to call `list_actions`, wire inputs by
`name` and "Fill every required property". `server/agent/systemPrompt.test.ts`
requires every tool name to appear, no other snake_case words, and the phrases
"call list_actions" and "won't do anything yet".

## Scope

`export function listActionsTool(actions: ActionSpec[], listChoices?:
ActionRegistry["listChoices"]): ToolDefinition`, keeping the name
`list_actions`:

- Description: lists the backend actions a Button can run, by what they work on
  (area) and what they do (operation). It returns the matches in full, with
  their input_schema, the dropdown choices for inputs that take one, and the
  question asked before the action runs, plus one line for every other action.
- `input_schema`, built when the tool is created (adding `type: "string"` to
  each property is fine):

  ```ts
  {
    type: "object",
    properties: {
      area: { enum: [...registeredAreas, "any"], description: "What the button works on. any when unsure." },
      operation: {
        enum: [...registeredOperations, "any"],
        description: "What the button does: create a new one; edit fields of an existing one (name, description, price, image, SKU); archive hides or unhides; delete removes for good; attach or detach offers or stops offering something on an item; other for anything else; any when unsure.",
      },
    },
    required: ["area", "operation"],
    additionalProperties: false,
  }
  ```

  `registeredAreas` is the specs' distinct areas, sorted, with `other` for a
  spec that has none. `registeredOperations` is the specs' distinct operations
  (`other` for none), in `ACTION_OPERATIONS` order.
- Actions whose area and operation both fit (`any` fits everything) are the
  matches, `match: "exact"`. If none fit, the area's actions are the matches,
  `match: "area"`. With at least one registered action, `actions` is never
  empty.
- Up to 10 matches (`MAX_LISTED_ACTIONS`), in registry order, come back in full:
  `name`, `description`, `input_schema`, `area` and `operation` (`other` when
  missing), and `confirm` and `choices` when set. Every other registered action
  appears in `others` as `{ name, area, operation, description }`, description
  cut to 120 characters.
- With `listChoices`, `data.choices[source]` is `{ values, truncated }` for each
  source named by a returned action, loaded once per call with `ctx.signal`: at
  most 50 values (`MAX_CHOICES`) in the order the source gives, `truncated` true
  when more exist. A source that rejects gives `{ values: [], truncated: false,
  error: "Couldn't load these choices." }`, the error is logged with
  `ctx.log.error`, and the tool still answers `ok: true`. Without `listChoices`
  there is no `choices` key.
- `data` shape: `{ match, actions, others, choices? }`. `summary` is `Listed N
  actions` (N = full matches), with ` (no exact match)` appended when `match` is
  `"area"`.
- Filtering is a few lines in the tool file: no search module, no free-text
  scoring.

`createAgentTools({ components, actions = [], listChoices })` gains the optional
`listChoices?: ActionRegistry["listChoices"]` and passes it to
`listActionsTool`. It still registers the same four tools; leave the
`renderUiTool` call unchanged.

`SYSTEM_PROMPT` changes:

- A new step before "Choose the components you need" (that phrase stays): if
  the request implies a button should do something, then, unless a fitting
  action was found earlier in the chat, call list_actions with the area and
  operation that fit what the button should do (any when unsure), and build the
  form around the returned inputs and choices.
- The same step includes, word for word: "Don't call list_actions when no
  button needs the server: a design without buttons, buttons that only move
  around the design (Cancel, Back, Close, Next), questions about the catalog,
  changes that leave a design's buttons alone, or a design the person calls a
  mockup."
- If the action you need is listed under others, call list_actions again with
  that action's area and operation; if no action fits, render the button without
  an action (keep "won't do anything yet").
- For an input that has choices, use a Select named after the input, with that
  source's values as its options.
- If the action has a confirm question, the person is asked it before the
  action runs, so say so in the reply.
- Besides every required property, give an input to each optional property the
  request mentions or implies; a form that edits something needs at least one
  field to change.
- No action, area, source or property names appear in the prompt, so the
  snake_case check still passes.

## Acceptance

- Both enums are built from the specs plus `any`; a call with an unknown value
  or a missing `area` or `operation` gets `Invalid arguments for list_actions`.
- With fixture specs that copy the menu actions' names, areas and operations
  in this registry order, after a `demo_echo` spec with neither:
  `menu_create_item` items/create, `menu_update_item` items/edit,
  `menu_set_item_archived` items/archive, `menu_set_item_image` items/edit,
  `menu_attach_modifier_group` modifier_groups/attach,
  `menu_detach_modifier_group` modifier_groups/detach, `menu_add_size`
  sizes/create, `menu_update_size` sizes/edit, `menu_set_size_price`
  prices/edit, `menu_remove_size` sizes/delete, `menu_create_category`
  categories/create, `menu_rename_category` categories/edit,
  `menu_delete_category` categories/delete, `menu_delete_modifier_group`
  modifier_groups/delete:
  - the area enum is `categories`, `items`, `modifier_groups`, `other`,
    `prices`, `sizes`, `any`;
  - items + edit returns `menu_update_item` then `menu_set_item_image`;
  - categories + delete returns `menu_delete_category`;
  - prices + edit returns `menu_set_size_price`;
  - items + archive returns `menu_set_item_archived`;
  - items + delete returns the four item actions with `match: "area"` and
    summary `Listed 4 actions (no exact match)`;
  - any + any returns the first 10 actions in full and the other 5 in `others`.
- Every action not returned in full is in `others`, descriptions cut to 120
  characters.
- Choices: listed once per source even when two returned actions share it;
  the 50 cap and `truncated`; a rejecting source gives the error entry, is
  logged, and the result is still `ok: true`; no `choices` key without
  `listChoices`.
- `systemPrompt.test.ts` checks that "call list_actions" comes before "Choose the
  components you need", checks the others, choices, optional-property,
  confirmation and "Don't call list_actions when no button needs the server"
  sentences, and keeps its existing checks.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, with `server/agent/tools/actions.test.ts` and
  `server/agent/systemPrompt.test.ts` updated as above; other tests that name
  `list_actions` (tool list, catalog Button description, `render_ui`'s "call
  list_actions to see them") pass unchanged.
- `npm run build:api` succeeds.
