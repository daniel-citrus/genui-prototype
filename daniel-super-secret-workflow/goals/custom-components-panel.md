---
id: custom-components-panel
priority: 50
depends:
  - custom-component-definitions
touches:
  - server/routes/customComponents.ts
  - server/routes/customComponents.test.ts
  - server/app.ts
  - server/index.ts
  - shared/api.ts
  - src/customComponentsClient.ts
  - src/customComponentsClient.test.ts
  - src/customComponentsPanel.ts
  - src/main.ts
scope: large
---

# Add a Components panel to preview, delete, restore and revert custom components

## Sources

- [Custom components plan: R13, R14, R16, Design (HTTP route)](../plans/custom-components.md#r13-custom-components-http-route)

## Context

Custom components are stored globally in Postgres with every version kept, and a delete only hides one. The person needs a place in the browser to see what exists, preview a component, and undo mistakes. Creating and editing stay with the agent through chat; this panel never accepts a template or schema.

Server today:
- `server/app.ts` (`buildApp(deps: AppDeps)`) registers `healthRouter`, `agentRouter` and `actionsRouter` under `/api/*` with the shared per-IP rate limit (`config: { rateLimit: {} }` on each route; see `server/routes/actions.ts` for a body limit and the `{ error: { message } }` error shape).
- `server/index.ts` builds the real adapters once, including `DrizzleComponentRepository(database.db)`, and passes deps to `buildApp`.
- Tests build the app with fakes (`server/app.test.ts`, `server/routes/*.test.ts`).
- When Postgres is down, the API still starts and repository calls fail on their own.

Browser today:
- `src/main.ts` renders the layout with `app.innerHTML`: a chat column whose header holds a placeholder session `<select>`, and a sandbox column.
- `src/sandbox/render.ts` (`renderUi(tree, container)`) draws a UI tree.
- `src/main.ts` sends a click only for `button[data-action]` inside the sandbox element.
- `src/actionsClient.ts` and `src/agentClient.ts` show the client style.

The goals already merged give you the rest:
- `custom-component-store`: `CustomComponentRepository` (`list({ includeDeleted, search, limit })` → `{ components, total }`, `getByName`, `getVersion`, `listVersions`, `save`, `softDelete`, `restore`; `CustomComponentError` codes `limit`, `deleted`, `conflict`, `name_taken`, `not_found`), `DrizzleCustomComponentRepository`, `InMemoryCustomComponentRepository`, and `CUSTOM_COMPONENT_NAME` in `shared/customComponents.ts`.
- `custom-component-definitions`: `expandTree(tree, { catalog, resolve })` in `server/customComponents/expand.ts`, used here to build a preview from a component's `exampleProps`.

## Scope

1. `server/routes/customComponents.ts` (new) `customComponentsRouter`, registered in `buildApp` under `/api/custom-components` when `deps.customComponents` (new optional `CustomComponentRepository`) and a component repository for the catalog are given. Add whatever optional deps it needs to `AppDeps`. Every route uses the shared rate limit and a 1 KB body limit.
   - `GET /` → 200 `{ components: CustomComponentSummary[] }`. Each summary has `name`, `description`, `category`, `version`, `versions`, `updatedAt` and `deletedAt`. Deleted components are included, ordered by name, at most 500.
   - `GET /:name` → 200 `{ component, versions, preview, previewErrors }`:
     - `component` is the current `StoredCustomComponent`;
     - `versions` lists `{ version, description, createdAt }`;
     - `preview` is `{ component: name, props: exampleProps }` expanded with `expandTree`, or `null` with `previewErrors` when expansion fails.
   - `DELETE /:name` → 204, or 404.
   - `POST /:name/restore` → 204, or 404.
   - `POST /:name/revert` with body `{ version: integer ≥ 1 }` → 200 `{ version }`, the new current version. It copies that version's definition with `save`. Returns 400 for a bad body, 404 for an unknown name or version, and 409 for a `limit` or `deleted` refusal, with the repository's message.
   - Every endpoint returns 400 when `:name` doesn't match `CUSTOM_COMPONENT_NAME`. No endpoint accepts a template or schema.
   - A repository failure returns 503 `{ error: { message: "Custom components are unavailable" } }` and logs it. Never log definitions.
2. `shared/api.ts`: add the response types (`CustomComponentSummary`, `CustomComponentDetail`) additively.
3. `server/index.ts`: create `new DrizzleCustomComponentRepository(database.db)` once and pass it, with the component repository, to `buildApp`. If the `custom-component-agent-tools` goal merged first and already created it, reuse that instance.
4. `src/customComponentsClient.ts` (new): `listCustomComponents()`, `getCustomComponent(name)`, `deleteCustomComponent(name)`, `restoreCustomComponent(name)` and `revertCustomComponent(name, version)`. Each returns the parsed body, or throws an `Error` carrying the route's message.
5. `src/customComponentsPanel.ts` (new), plus a "Components" button in the chat header in `src/main.ts`, which opens and closes the panel over the chat column:
   - **List:** each component's name, description, version and last update. Deleted ones go in a separate "Deleted" group with a Restore button.
   - **Empty state:** "No custom components yet. Ask the agent to save part of a design as a component."
   - **Detail (on select):** the preview drawn with `renderUi` into a container outside the sandbox element, with every `data-action` attribute removed after drawing, so preview buttons never send actions. Also shown: any preview problems, the version list with "Revert to version n" on older versions, and Delete.
   - **Actions:** after delete, restore or revert, refresh the list and detail. On failure, show the route's message in the panel.
   - Build all text with `textContent`, never `innerHTML` with data.

## Acceptance

- Route tests with `InMemoryCustomComponentRepository` and the real catalog:
  - list includes deleted components flagged with `deletedAt`;
  - detail returns the current version, the version list and an expanded preview containing only catalog components;
  - delete and restore return 204, and 404 for unknown names;
  - revert creates a new current version equal to the chosen one, 404 for an unknown version, 409 past 20 versions or for a deleted component;
  - a bad name returns 400, and a repository that throws gives 503;
  - no route accepts a definition.
- The client functions send the right method and path and surface route messages as errors.
- In the browser:
  - the header button opens the panel, which lists components and shows the empty state when there are none;
  - selecting one shows its preview, whose buttons have no `data-action`, and its versions;
  - delete, restore and revert update the list.
- Existing routes and the sandbox behave as before.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including new `server/routes/customComponents.test.ts` (built with `buildApp` and fakes, no database) and `src/customComponentsClient.test.ts` (with a stubbed `fetch`).
- `npm run build` and `npm run build:api` pass.

## After merge

- With Postgres running and a few custom components saved, open the Components panel and check by eye that preview, delete, restore and revert work and that preview buttons do nothing.
