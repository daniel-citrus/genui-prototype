---
id: custom-component-agent-tools
priority: 50
depends:
  - custom-component-render
touches:
  - server/agent/tools/customComponents.ts
  - server/agent/tools/customComponents.test.ts
  - server/agent/tools/components.ts
  - server/agent/tools/components.test.ts
  - server/agent/tools/index.ts
  - server/agent/systemPrompt.ts
  - server/agent/systemPrompt.test.ts
  - server/agent/loop.test.ts
  - server/index.ts
scope: large
---

# Let the agent define, find and delete custom components

## Sources

- [Custom components plan: R9, R10, R11, R12, R16, Design (Tools)](../plans/custom-components.md#r9-define_component-tool)

## Context

The agent's tools are built in `server/agent/tools/index.ts` (`createAgentTools({ components, actions, listChoices, customComponents? })`) and wired once in `server/index.ts`, which creates `DrizzleComponentRepository(database.db)` and passes the result through `createToolRegistry`.

`server/agent/registry.ts` handles the plumbing for every tool:
- it validates arguments against each tool's closed `input_schema`;
- a throwing handler becomes `{ ok: false, summary: "<tool> failed" }`;
- any result whose `data` serializes longer than 16,384 characters is cut to a note.

Today's component tools are in `server/agent/tools/components.ts`:
- `list_components` takes an optional `category` and returns name, category, description and children for every catalog component, with the summary "Listed N components".
- `get_component` takes `name` and returns the props schema and example. An unknown name returns `available` and, on a case mismatch, `didYouMean`.

`server/agent/systemPrompt.ts` currently tells the agent to use only catalog components and, when nothing fits (a chart, a table, a date picker), to say so and offer the closest alternative. `server/agent/systemPrompt.test.ts` requires every tool name to appear in the prompt and no other snake_case words, and checks several exact sentences. `server/agent/loop.test.ts` and `components.test.ts` assert "Listed ${catalog.length} components".

The goals already merged give you the rest:
- `custom-component-store`: `CustomComponentRepository`, with `list({ includeDeleted, search, limit })` returning `{ components, total }`, `getByName`, `save` (which rejects a `CustomComponentError` coded `limit`, `deleted`, `conflict` or `name_taken`), `softDelete` and `restore`. Also `DrizzleCustomComponentRepository(db)`, the in-memory fake and the `shared/customComponents.ts` types.
- `custom-component-definitions`: `validateDefinition(definition, { catalog, resolve, actions })` in `server/customComponents/definition.ts`, which returns `{ ok: true, definition }` or `{ ok: false, errors }`.
- `custom-component-render`: `render_ui` expands custom components when `createAgentTools` gets `customComponents`.
- `markup-component`: the `Markup` catalog component, used only inside templates.

The user's rules for the agent:
- prefer existing components;
- build a new component only when needed, including Markup-based ones that draw what nothing existing can;
- custom components may only use actions already in the registry, and the agent never creates actions.

## Scope

1. `server/agent/tools/customComponents.ts` (new):
   - `define_component`:
     - **Input schema**, closed, all required: `name` (string), `description` (string), `category` (enum of the four), `children` (enum `none` or `any`), `props_schema` (object), `example_props` (object), `template` (object).
     - **On success:** map the arguments to `CustomComponentDefinition`, run `validateDefinition` with the catalog, a `resolve` backed by the repository and the registered action specs, then `save`. Return `{ ok: true, summary: "Saved <Name> v<version>", data: { name, version } }`.
     - **On refusal:** `{ ok: false, summary: "Definition has N problems", data: { errors } }`, with nothing saved.
     - **On a `CustomComponentError`:** `{ ok: false, summary: <its message> }`.
   - `delete_component`, with input `{ name }`:
     - soft-deletes the component and answers "Deleted <Name>; it can be restored from the Components panel";
     - refuses an unknown name and a catalog name.
   - Neither tool logs definitions: log only names, versions and outcomes.
2. `server/agent/tools/components.ts`:
   - `listComponentsTool(components, customComponents?)`: with a repository and no `category` filter, or a matching category, it also returns up to 40 custom components that aren't deleted, ordered by name. Each entry is `{ name, category, description (cut to 200 characters), children, custom: true, version }`.
   - Leave out a custom component whose name matches a catalog name ignoring case.
   - When more exist than are shown, add `data.more: { count, hint: "Pass search to narrow custom components" }`.
   - New optional argument `search` (string, at most 100 characters) filters custom components by name or description.
   - The summary stays "Listed N components" counting everything returned.
   - `getComponentTool(components, customComponents?)`: catalog names first. Otherwise a custom component that isn't deleted returns `{ name, category, description, children, propsSchema, exampleProps, custom: true, version, template }`. `didYouMean` covers custom names.
   - Without the repository, both tools behave exactly as today.
3. `createAgentTools` adds the two new tools only when `customComponents` is given, and passes it to the list and get tools.
4. `server/index.ts`: create `new DrizzleCustomComponentRepository(database.db)` once, next to the component repository, and pass it to `createAgentTools`. If the `custom-components-panel` goal merged first and already created it, reuse that instance.
5. `server/agent/systemPrompt.ts`: replace the "only catalog components" and "nothing in the catalog fits" instructions with:
   - **Order of preference:** catalog components, then existing custom components (from `list_components`), then a new custom component composed of those with `define_component`. Only for what nothing existing can draw, a new custom component whose template uses `Markup`.
   - **When to define:** when the person asks to save or reuse part of a design, or when the request needs something no existing component draws. Never define one for a single use that existing components already cover.
   - **Before using one:** read a custom component with `get_component`, like any component.
   - **Actions:** a template's buttons may only use actions `list_actions` returned. Never invent action names, and never try to create actions.
   - **Reply:** say when a custom component was created or updated. Use `delete_component` only when the person asks to delete one.

   Update `systemPrompt.test.ts` for the new sentences, and keep the existing action sentences. If the snake_case-words test or `loop.test.ts` counts change because the prompt names `define_component`, `delete_component` and `get_component`, update those tests to match.
6. If Postgres is unreachable, the custom tools fail on their own with a clear summary ("Custom components are unavailable"). The API still starts and every other tool works as before.

## Acceptance

- `define_component`:
  - saves a valid definition as v1, and again as v2;
  - returns every problem from `validateDefinition` and saves nothing;
  - returns the repository's limit, deleted, conflict and name-taken messages.
- `delete_component` hides a component (it no longer appears in `list_components`, and `get_component` reports it unknown) and refuses unknown and catalog names.
- `list_components`:
  - with no custom components, returns exactly today's result;
  - with 45, returns 40 plus `more.count` of 5;
  - `search` narrows the list;
  - a custom name that matches a catalog name ignoring case is hidden.
- `get_component` returns a custom component's template and version, and its `didYouMean` suggests custom names.
- The system prompt states the order of preference, when to define, the registered-actions-only rule and the reply rule. The prompt tests pass with the new tool names.
- With a repository that throws, the custom tools return the "unavailable" summary and catalog-only `list_components` still works.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including new `server/agent/tools/customComponents.test.ts` and new cases in `server/agent/tools/components.test.ts` and `server/agent/systemPrompt.test.ts`. They use `InMemoryComponentRepository`, `InMemoryCustomComponentRepository` and a small action registry, and need no database or OpenAI key.
- `npm run build:api` passes.

## After merge

- With `OPENAI_API_KEY` set, ask "a bar chart of this week's sales: Mon 12, Tue 18, Wed 9" and check that the agent defines a Markup-based chart component and renders it.
- Ask "save this card as MenuItemCard", then in a new chat "show three menu item cards", and check that it reuses the saved component.
- Ask "make a form to change a menu item's price as a custom component" and check that its Save button runs `menu_set_size_price` and a click changes the demo menu after the usual checks.
- Ask the agent to add a script, a link or a full-screen overlay to a component, and check that it is refused or left out.
- Ask for a simple form the catalog already covers and check that the agent does not define a new component.
- Check that a definition near 8,000 characters fits in one completion at the default `AGENT_MAX_OUTPUT_TOKENS`.
