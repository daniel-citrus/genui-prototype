---
id: ui-tree-render-tool
priority: 10
depends: []
touches:
  - shared/ui.ts
  - shared/api.ts
  - server/ui/validateTree.ts
  - server/ui/validateTree.test.ts
  - server/agent/tools.ts
  - server/agent/run.ts
  - server/agent/tools/ui.ts
  - server/agent/tools/ui.test.ts
  - server/agent/tools/index.ts
  - server/agent/tools/components.test.ts
  - server/agent/registry.test.ts
  - server/agent/loop.test.ts
  - server/catalog/components.ts
  - docs/ARCHITECTURE.md
scope: medium
---

# Check UI trees against the catalog and render them with `render_ui`

## Sources

- [Guardrails plan — Step 1, Design checker and render_ui](../plans/agent-guardrails.md#step-1--design-checker-and-render_ui)
- [Guardrails plan — Target architecture](../plans/agent-guardrails.md#target-architecture)

## Context

The agent can only look components up today. `server/agent/tools/components.ts` has `list_components` and `get_component`, which read the catalog through the `ComponentRepository` port. When asked for a UI, the agent describes it in prose. Nothing checks the design, and nothing reaches the browser's sandbox pane, which is an empty placeholder.

Relevant code:

- **Catalog:** `server/catalog/components.ts` exports `catalog: CatalogComponent[]`, twelve components. Each has `name`, `category`, `children` (`"none"` or `"any"`), `propsSchema` (a closed JSON Schema object) and `exampleProps`. Only Stack and Card have `children: "any"`. `ComponentRepository.list()` returns stored `Component`s, which add `id`, `createdAt` and `updatedAt`, as new objects on every call.
- **Validation:** `server/validation/jsonSchema.ts` has the shared strict Ajv instance, `compileSchema(schema)` and `formatSchemaErrors(errors)`, which returns `{ path, message }` with JSON-Pointer paths. `server/catalog/validate.ts` turns pointers into dotted paths, for example `exampleProps.variant`.
- **Tools:** `server/agent/tools.ts` defines `ToolDefinition` and `ToolContext` (`signal`, `log`). `createToolRegistry` in `server/agent/registry.ts` validates arguments against each tool's closed `input_schema`, then runs it. `createAgentTools({ components })` in `server/agent/tools/index.ts` lists the agent's tools.
- **Events:** `handleToolCall` in `server/agent/run.ts` emits `tool_call`, runs the tool through `run.tools.run(name, args, { signal, log })`, then emits `tool_result`. `AgentEvent` in `shared/api.ts` is the SSE event union: `text`, `tool_call`, `tool_result`, `notice`, `done` and `error`.
- **Tests:** `server/ports/fakes/InMemoryComponentRepository.ts` is the test fake, built from `catalog`.

This goal is server-side only. A later goal (`sandbox-renderer`) draws `ui` events in the browser, and `system-prompt-rewrite` tells the model how to use `render_ui`. Until then the browser ignores `ui` events.

## Scope

**1. The tree type**, in a new `shared/ui.ts`:

```ts
export interface UiNode {
  component: string;                 // catalog name, exact case: "Button"
  props?: Record<string, unknown>;   // must match that component's propsSchema
  children?: UiNode[];               // only on components whose children is "any"
}
```

**2. The checker**, `validateUiTree(tree: unknown, catalog: Component[])` in `server/ui/validateTree.ts`. It's a pure function. It walks the whole tree and collects every problem instead of stopping at the first. It returns `{ ok, errors: string[], stats: { nodes, depth, components } }`, where `components` counts uses per component name.

| Problem | Example error |
|---|---|
| Malformed node: not an object, `component` not a string, `props` not an object, `children` not an array, or any other key | `tree.children.1 must be an object with a "component" string` |
| Component not in the catalog (exact-case match) | `tree.children.0.component "button" is not in the catalog (did you mean Button?)` |
| Props that break the component's `propsSchema` (missing required, wrong type, value outside an enum, extra prop) | `tree.children.2.props.variant must be one of primary, secondary, danger` |
| `children` on a component whose `children` is `"none"` | `tree.children.3 Button cannot have children` |
| More than 8 levels deep (root is level 1) or more than 100 nodes | `tree has 140 nodes (max 100)` |

- **Paths** are dotted and start at `tree`, for example `tree.children.2.props.variant`.
- **Error cap:** at most 20 errors are returned. If there are more, the 20th entry is replaced by `…and N more`, so 20 entries are returned in all.
- **Wrong case:** "did you mean" is offered when a name matches a catalog name ignoring case.
- **Validator cache:** cache each component's compiled props validator in a module-level `Map` keyed by `name` and `updatedAt`. Ajv's own cache is keyed by schema object identity, and `list()` returns new objects on every call, so compiling on every call would grow Ajv's cache without bound. Export a way for tests to observe compiles, for example a counter.

**3. A narrow way for tools to reach the browser.** `ToolContext` gains `showUi(tree: UiNode): void`. `handleToolCall` implements it as `run.emit({ type: "ui", tree })`. Tools get no general `emit`. `AgentEvent` gains `{ type: "ui"; tree: UiNode }`. Update every test that builds a `ToolContext` by hand (`registry.test.ts`, `tools/components.test.ts`, and `loop.test.ts` if needed) to pass a no-op `showUi`.

**4. The `render_ui` tool**, in `server/agent/tools/ui.ts`, added to `createAgentTools`:

| | |
|---|---|
| Name | `render_ui` |
| Description | "Check a UI tree against the catalog and show it in the sandbox. Send the whole tree every time, including for small edits. If it reports problems, nothing is shown: fix them and call it again." |
| `input_schema` | `{ type: "object", properties: { tree: { type: "object", description: "The whole UI tree: { component, props, children }." } }, required: ["tree"], additionalProperties: false }`. Keep it shallow; the checker checks the structure, because its errors name the exact node. |
| Problems found | `{ ok: false, summary: "UI has N problems", data: { errors } }`. `showUi` is **not** called. |
| Valid | Calls `ctx.showUi(tree)` once, then returns `{ ok: true, summary: "Rendered N components", data: { stats } }`, where N is `stats.nodes`. The tree is **not** echoed back in `data`, because the model already has it in its own tool call. |

It reads the catalog with `components.list()` on each call. A repository error is thrown and becomes the registry's generic `render_ui failed` result.

**5. Image URLs must be http(s).** Ajv's `format: "uri"` accepts `javascript:` and `data:` URLs. Add `pattern: "^https?://"` to Image's `src` in `server/catalog/components.ts`, next to the existing `format`. The seed applies it to the stored row; production seeds on start, and development runs `npm run db:seed`.

**6. Docs.** In `docs/ARCHITECTURE.md`, add `render_ui` to the tools and to the system overview diagram's registry box, add the `ui` event wherever SSE events are listed, and describe the UI tree and the checker briefly. Update "Current limits": the agent can now render, but the browser doesn't draw `ui` events until the sandbox renderer lands.

**Out of scope:** browser changes, the system prompt, and turn limits.

## Acceptance

- `validateUiTree` reports each problem in the table with the stated message shape, and reports several problems in one call.
- A tree with more than 20 problems returns exactly 20 entries, the last being `…and N more`.
- Calling `validateUiTree` repeatedly with fresh `list()` results for an unchanged catalog compiles each component's validator only once. A changed `updatedAt` compiles it again.
- Every catalog component's `exampleProps`, as children of a Stack, form a valid tree.
- An Image whose `src` is `javascript:alert(1)` or `data:image/png;base64,AAAA` is rejected, and an `https://` URL is accepted.
- Against `InMemoryComponentRepository`, `render_ui` with a valid tree calls `showUi` exactly once with that tree and returns `ok: true`, "Rendered N components". With an invalid tree, it doesn't call `showUi` and returns `ok: false` with the errors.
- Through `handleToolCall`, a valid `render_ui` call emits `tool_call`, then `ui`, then `tool_result`, in that order.
- `createAgentTools` registers `list_components`, `get_component` and `render_ui`.
- The catalog still passes `server/catalog/validate.ts`, and `npm run typecheck` passes.

## Validation

- `npm run typecheck`, `npm test`, `npm run build` and `npm run build:api` pass.
- With Postgres running, also run `DATABASE_URL=postgres://genui:genui@localhost:5432/genui npm test`, so the seed and repository tests run against the changed Image schema. Without Postgres, those tests skip; say so.
- New tests to write: `server/ui/validateTree.test.ts` and `server/agent/tools/ui.test.ts`, plus an ordering test for `handleToolCall`, in `server/agent/loop.test.ts` or a new `server/agent/run.test.ts`.
