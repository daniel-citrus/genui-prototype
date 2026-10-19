---
id: sandbox-renderer
priority: 40
depends:
  - ui-tree-render-tool
touches:
  - src/sandbox/componentNames.ts
  - src/sandbox/componentNames.test.ts
  - src/sandbox/components.ts
  - src/sandbox/render.ts
  - src/main.ts
  - docs/ARCHITECTURE.md
scope: medium
---

# Draw rendered designs in the sandbox

## Sources

- [Guardrails plan — Step 4, Sandbox renderer](./agent-guardrails.md#step-4--sandbox-renderer)
- [Guardrails plan — A design request, end to end](./agent-guardrails.md#a-design-request-end-to-end)

## Context

This builds on `ui-tree-render-tool`, merged into the base before this goal starts. It added:

- **`UiNode`** in `shared/ui.ts`: `{ component: string; props?: Record<string, unknown>; children?: UiNode[] }`.
- **A new SSE event** `{ type: "ui"; tree: UiNode }` in the `AgentEvent` union in `shared/api.ts`. The server's `render_ui` tool sends it only after the tree passes a check against the catalog, so the browser can trust every tree it receives: names, props and children all match the catalog.

The browser is one file, `src/main.ts`. It builds the layout as an HTML string; the sandbox pane is `<section aria-label="Sandbox">`, holding an empty dashed `<div>`. `renderEvent(event, bubble)` switches on `event.type` for the chat thread, and has no `ui` case yet, so `ui` events are ignored. Styling is Tailwind v4 through `@tailwindcss/vite`, using utility classes written in the source.

**How tests typecheck:** `tsconfig.app.json` covers `src` and excludes `src/**/*.test.ts`. Those tests are typechecked by `tsconfig.server.json`, whose `lib` is `ES2023` with **no DOM**. A test that imports a module using `document` or `HTMLElement` therefore fails `npm run typecheck`. Keep anything a test imports DOM-free.

The catalog, `server/catalog/components.ts`, defines these components, props and defaults:

| Component | Props (required in bold) and defaults |
|---|---|
| Stack (children) | `direction` vertical\|horizontal = vertical; `gap` none\|sm\|md\|lg = md; `align` start\|center\|end\|stretch = stretch |
| Card (children) | `title` string; `padding` sm\|md\|lg = md |
| Divider | — |
| Heading | **`text`**; `level` 1\|2\|3 = 2 |
| Text | **`text`**; `size` sm\|md = md; `tone` default\|muted = default |
| Button | **`label`**; `variant` primary\|secondary\|danger = primary; `size` sm\|md\|lg = md; `disabled` boolean = false |
| TextInput | **`label`**; `placeholder` string; `type` text\|email\|password\|number = text; `required` boolean = false |
| Checkbox | **`label`**; `checked` boolean = false |
| Select | **`label`**; **`options`** string[] (at least 1); `placeholder` string |
| Image | **`src`** (http(s) URL); **`alt`**; `width` sm\|md\|lg\|full = full |
| Badge | **`text`**; `tone` neutral\|success\|warning\|danger = neutral |
| Alert | **`message`**; `title` string; `tone` info\|success\|warning\|danger = info |

## Scope

1. **`src/sandbox/componentNames.ts`** (DOM-free): `export const RENDERED_COMPONENTS = ["Stack", "Card", ...] as const` and `export type RenderedComponentName = (typeof RENDERED_COMPONENTS)[number]`.
2. **`src/sandbox/components.ts`**: one function per component, `(props, children: HTMLElement[]) => HTMLElement`, in a map typed `Record<RenderedComponentName, Renderer>`, so TypeScript forces exactly one function per listed name. Apply the defaults in the table when a prop is missing.
3. **`src/sandbox/render.ts`**: `renderUi(tree: UiNode, container: HTMLElement)` clears the container and draws the tree recursively. Also export an empty-state function that shows "Designs you ask for appear here."
4. **`src/main.ts`**: give the sandbox's inner div a selector, show the empty state on load, and add `case "ui": renderUi(event.tree, sandbox)` to `renderEvent`. All drawing code stays in `src/sandbox/`.
5. **Docs:** in `docs/ARCHITECTURE.md`, replace "Sandbox pane (placeholder)" in the system overview, describe the renderer in the browser section, mention the `ui` event in the chat-turn section, and update "Current limits".

Rules for the renderer:

- **Never treat text as HTML.** Every string from a tree goes in through `textContent` or a named attribute (`placeholder`, `alt`, `src`, `type`, `value`). Never use `innerHTML` or `insertAdjacentHTML` with tree data.
- **Check image URLs again.** Draw the Image only if `new URL(src).protocol` is `http:` or `https:`; otherwise draw a small "Image unavailable" placeholder.
- **Write Tailwind classes out in full.** Tailwind only generates classes it finds as complete strings in the source. Use maps of full class strings, such as `{ primary: "bg-zinc-900 text-white hover:bg-zinc-800", ... }`, never template-built classes like `` `bg-${tone}-100` ``.
- **Draw unknown components as placeholders.** A name not in the map (the catalog can gain a component before the browser has a function for it) draws a dashed box labeled `Unknown component: <name>`. It must never throw.
- **Make the drawn UI live but inert.** Inputs can be typed in, and checkboxes and selects work. Buttons use `type="button"`. Nothing is submitted or sent anywhere.
- **Label inputs properly.** TextInput, Checkbox and Select each get a `<label>` tied to the control with a generated unique `id`.
- **Show only the latest design.** A new `ui` event replaces the old one, and nothing is saved.

**Out of scope:** sending input values back to the agent, saving designs, and server changes.

## Acceptance

- `src/sandbox/componentNames.test.ts` passes. It asserts that `RENDERED_COMPONENTS` and the names in `server/catalog/components.ts` are the same set, so adding a catalog component without a renderer fails `npm test`.
- `npm run typecheck` passes, including the test under the DOM-free server config. `components.ts` and `render.ts` aren't imported by any test.
- On load, the sandbox shows "Designs you ask for appear here."
- A `ui` event replaces the sandbox's contents with the drawn tree. Every catalog component draws using the table's props and defaults, and children nest inside Stack and Card.
- No tree data reaches `innerHTML` or `insertAdjacentHTML` (search the diff for them).
- A non-http(s) image `src` draws the placeholder, and an unknown component draws the labeled placeholder without errors.

## Validation

- `npm run typecheck`, `npm test`, `npm run build` and `npm run build:api` pass.
- **Manual check without a model:** in `npm run dev:web`, call `renderUi` with a tree that uses all twelve catalog components, built from their `exampleProps` inside a Stack. For example, wire it temporarily, or run it from the browser console through a dev-only hook that is removed before committing. Check that each one draws correctly with its variants.
- **Manual check end to end,** only if `OPENAI_API_KEY` and a seeded Postgres are available: ask "Design a signup form in a titled panel". The form appears in the sandbox. Then ask "Make the button a danger button", and the sandbox shows the updated design. Without them, say that check wasn't run.
