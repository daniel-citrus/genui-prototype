---
id: component-tools
priority: 50
depends:
  - catalog-seed
  - tool-registry-core
touches:
  - server/agent/tools/index.ts
  - server/agent/tools/components.ts
  - server/agent/tools/components.test.ts
  - server/ports/fakes/InMemoryComponentRepository.ts
  - server/agent/loop.ts
  - server/agent/loop.test.ts
  - server/index.ts
  - docs/ARCHITECTURE.md
scope: medium
---

# Give the agent tools to look up components

## Sources

- [Tool registry plan — Step 2, Component tools](../plans/tool-registry.md#4-step-2--component-tools)
- [Tool registry plan — Step 3, Wiring and the system prompt](../plans/tool-registry.md#5-step-3--wiring-and-the-system-prompt)
- [Tool registry plan — Step 4, Tests, docs, and checks](../plans/tool-registry.md#6-step-4--tests-docs-and-checks)

## Context

This builds on `tool-registry-core` and `catalog-seed`, merged into the base before this goal starts.
- **`tool-registry-core`** added `ToolDefinition` and `ToolContext` in `server/agent/tools.ts`, and `createToolRegistry(definitions)` in `server/agent/registry.ts`. The registry validates arguments against each tool's closed `input_schema`, turns unknown tools, invalid arguments and thrown errors into `ok: false` results, and logs failures. `server/index.ts` passes `emptyToolRegistry`, which is `createToolRegistry([])`, to `agentRouter`.
- **`catalog-seed`, which builds on `catalog-schema`,** made the `components` table a catalog of twelve predefined components.
  - The catalog lives in `server/catalog/components.ts` as `catalog: CatalogComponent[]`.
  - Each component has `name`, `description`, `category` (`layout|text|input|display`), `children` (`none|any`), `propsSchema` and `exampleProps`.
  - The read-only `ComponentRepository` port has `list()` (ordered by category, then name), `get(id)` and `getByName(name)`.
  - `server/index.ts` already builds a `DrizzleComponentRepository`.

Read those files first. The agent has no tools today. Its system prompt (`SYSTEM_PROMPT` in `server/agent/loop.ts`) is short guidelines for a UI-design assistant. The browser already shows `tool_call` and `tool_result` events as compact lines, so no browser change is needed.

## Scope

**Fake repository** (`server/ports/fakes/InMemoryComponentRepository.ts`): implements `ComponentRepository` over an array of `CatalogComponent`, assigning ids and timestamps, with the same ordering as the Drizzle adapter. Tests build it from the real `catalog`.

**Tools** (`server/agent/tools/components.ts`), using only the port's read methods:

`list_components`
- **Description:** "List the predefined UI components you can use, with what each is for. Call this before choosing components."
- **Input:** `{ category?: "layout" | "text" | "input" | "display" }`, closed schema.
- **Data:** `{ components: [{ name, category, description, children }] }` from `list()`, filtered by category when given. It leaves out `propsSchema` and `exampleProps`, so the list stays short.
- **Summary:** `Listed 12 components`, or `Listed 3 layout components` when filtered.

`get_component`
- **Description:** "Get one component's props schema and an example. Call this before using a component, so its props are valid."
- **Input:** `{ name: string }`, required, closed schema.
- **Data:** `{ name, category, description, children, propsSchema, exampleProps }` from `getByName(name)`.
- **Summary:** `Read <name>`.
- **Not found:** `{ ok: false, summary: "No component named <name>", data: { available: [<all names>] } }`. If a name matches ignoring case, add `didYouMean: "<name>"`.

A database error is left to throw, so the registry reports `<tool> failed` and logs it.

**Assembly** (`server/agent/tools/index.ts`): `createAgentTools({ components }: { components: ComponentRepository }): ToolDefinition[]` returns both tools. `server/agent/tools.ts` and the `server/agent/tools/` directory sit side by side, so import the directory explicitly (`./tools/index`) to avoid ambiguity.

**Wiring** (`server/index.ts`):
- Build `createToolRegistry(createAgentTools({ components }))` once with the existing `DrizzleComponentRepository`, and pass it to `agentRouter` in place of `emptyToolRegistry`.
- The API must still start without Postgres. The tools then fail per call.

**System prompt** (`server/agent/loop.ts`): add two guidelines.
- Use only the predefined components. Call `list_components` to see them, and `get_component` before relying on a component's props.
- If no component fits the request, say so instead of inventing one.

**Docs** (`docs/ARCHITECTURE.md`):
- The tool registry is no longer empty. Name the two tools.
- Update the overview diagram's tool registry node, and the "Current limits" section.
- Keep every Mermaid diagram valid.

Out of scope: tools that render or change anything, OpenAI strict mode, and a search tool.

## Acceptance

- In a chat turn, the model's `list_components` call returns every catalog component's name, category, description and children, with no props schema. With `{ "category": "layout" }` it returns only `Stack`, `Card` and `Divider`.
- `get_component` with `{ "name": "Button" }` returns Button's `propsSchema` and `exampleProps`.
  - `{ "name": "button" }` returns `ok: false` with `didYouMean: "Button"`.
  - `{ "name": "Carousel" }` returns `ok: false` with the available names.
- An extra or wrongly typed argument, such as `{ "name": 3 }` or `{ "category": "widget" }`, is refused by the registry before the tool runs.
- With the API running against the seeded database, asking "what components can I use?" shows a `list_components` call in the thread and a reply that names the seeded components.
- With Postgres stopped, the API still starts. A tool call returns `ok: false` with summary `list_components failed`, and the turn finishes with `done`.
- `npm run typecheck`, `npm test`, `npm run build` and `npm run build:api` pass.

## Validation

- New `server/agent/tools/components.test.ts`, which this goal adds, using the in-memory fake built from the real catalog:
  - listing all components, and by category;
  - reading one component;
  - an unknown name;
  - a wrong-case name;
  - a repository that throws, which must surface as `ok: false` through the registry.
- `server/agent/loop.test.ts`: a new case in which a scripted model calls `list_components`, then `get_component`, then replies. It uses the real registry and the fake. The history holds both tool results, and the events include `tool_call` and `tool_result` for each.
- `npm test`, `npm run typecheck`, `npm run build` and `npm run build:api`: pass.
- Manual, with `OPENAI_API_KEY` set:
  1. Run `docker compose up -d db && npm run db:migrate && npm run db:seed && npm run dev`.
  2. At http://localhost:5173, ask "what components can I use?" and confirm the tool line and the reply.
  3. Stop the dev servers afterwards.
  If no key is available, say so in the PR instead of claiming this check.
