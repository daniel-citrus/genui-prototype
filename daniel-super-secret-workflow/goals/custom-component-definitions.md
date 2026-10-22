---
id: custom-component-definitions
priority: 30
depends:
  - custom-component-store
  - markup-component
touches:
  - server/catalog/validate.ts
  - server/customComponents/definition.ts
  - server/customComponents/definition.test.ts
  - server/customComponents/expand.ts
  - server/customComponents/expand.test.ts
scope: large
---

# Validate custom component definitions and expand them into catalog components

## Sources

- [Custom components plan: R2, R3, R4, Design (Interfaces, Errors and edge cases)](../plans/custom-components.md#r2-definition-rules)

## Context

Custom components let the agent reuse a design piece by name. A definition has a name, description, category, children setting, props schema, example props and a template. The server must refuse bad definitions before saving them, and must turn every custom component in a design into plain catalog components ("expansion") before validation and before anything reaches the browser. This goal writes those two pure functions. Later goals call them from `render_ui`, the new `define_component` tool and the Components panel route.

This builds on `custom-component-store`, which added `shared/customComponents.ts`:
- `TemplateNode` and `CustomComponentDefinition`;
- `StoredCustomComponent`, which adds `version`, `versions`, `createdAt`, `updatedAt` and `deletedAt: string | null`;
- `CUSTOM_COMPONENT_NAME` (`/^[A-Z][A-Za-z0-9]*$/`);
- the limits `MAX_DEFINITION_CHARS` 8000, `MAX_DESCRIPTION_CHARS` 300, `MAX_TEMPLATE_NODES` 40, `MAX_TEMPLATE_DEPTH` 6, `MAX_CUSTOM_NESTING` 3, `MAX_EXPANDED_NODES` 400 and `MAX_EXPANDED_DEPTH` 24.

It also builds on `markup-component`, which added:
- the `Markup` catalog component, whose `props.root` is a JSON element tree (`shared/markup.ts`: `{ tag, attrs?, style?, text?, action?, children? }`; `text`, attribute values and style values may be `{ "$prop": name }`);
- `validateMarkup`, which refuses any placeholder left unfilled;
- `validateUiTree(tree, catalog, actions?, choiceValues?, options?)` with `options.designChecks` (false skips the missing-required-input and edit-form checks) and `options.maxNodes` and `options.maxDepth`.

Other code to reuse:
- `server/catalog/validate.ts` has a private `componentProblems(component)`: the name pattern, a non-empty description, a valid closed object `propsSchema` with a `description` on every property, valid `default`s, and `exampleProps` valid against the schema. It uses the shared strict Ajv instance in `server/validation/jsonSchema.ts` (`schemaProblem`, `compileSchema`, `formatSchemaErrors`).
- `server/ui/validateTree.ts` caps output at 20 errors (`MAX_ERRORS`), the last summarizing the rest, and caches props validators per name and `updatedAt`.
- UI tree nodes are `{ component, props?, children? }` (`shared/ui.ts` `UiNode`), with paths like `tree.children.0.props.text`.

## Scope

1. In `server/catalog/validate.ts`, export the existing per-entry check (for example as `catalogEntryProblems(entry: CatalogComponent): string[]`) without changing `validateCatalog`'s behavior or messages.
2. `server/customComponents/expand.ts` (new):

   ```ts
   export interface Expansion {
     tree: UiNode;                 // catalog components only
     errors: string[];             // instance props, children, deleted, loops, nesting
     /** Expanded-tree path prefix → label used to rewrite validator messages. */
     origins: Map<string, string>;
   }
   export function expandTree(
     tree: unknown,
     ctx: { catalog: Component[]; resolve: (name: string) => Promise<StoredCustomComponent | undefined> },
   ): Promise<Expansion>;
   export function rewritePaths(errors: string[], origins: Map<string, string>): string[];
   ```

   - Catalog names win: a node whose `component` is a catalog name (exact) is copied as is, with its children expanded.
   - A node naming a custom component:
     1. Its `props` are checked against that version's `propsSchema`, compiled once per name and version. A problem reads `tree.children.0.props.price is required`.
     2. Children on a definition whose children is `none` are refused.
     3. The template is copied, and every `{ "$prop": n }` is filled: whole prop values in template nodes, plus Markup `text`, attribute and style values. Use the instance value, else the schema's `default`, else leave that prop, attribute, style or text out.
     4. A `{ "$children": true }` entry is replaced by the instance's expanded children, spliced in place.
     5. The result is expanded again, so templates may use other custom components.
   - Deleted components: a custom node in the caller's own tree whose component is deleted is refused with "`<Name>` was deleted; restore it in the Components panel or use another component". Inside a template, a deleted component still expands.
   - More than `MAX_CUSTOM_NESTING` levels of custom inside custom, or a loop (`A → B → A`), adds an error naming it and stops expanding that branch. Never recurse without bound.
   - A name that is neither catalog nor custom is left as is, so `validateUiTree` reports "not in the catalog".
   - `origins` maps the expanded path where a template's root lands to `"<agent path> (<Name> v<version>) template"`. It also maps the expanded path of each spliced instance child back to that child's own path. `rewritePaths` replaces the longest matching path prefix at the start of each message, so a validator error reads `tree.children.0 (MenuItemCard v3) template.children.1.props.text must be string`.
3. `server/customComponents/definition.ts` (new):

   ```ts
   export function validateDefinition(
     definition: unknown,
     ctx: { catalog: Component[]; resolve: (name: string) => Promise<StoredCustomComponent | undefined>; actions: ActionSpec[] },
   ): Promise<{ ok: true; definition: CustomComponentDefinition } | { ok: false; errors: string[] }>;
   ```

   It reports every problem together, at most 20, the last summarizing the rest:
   - **Keys:** exactly `name`, `description`, `category`, `children`, `propsSchema`, `exampleProps`, `template`.
   - **Name:** matches `CUSTOM_COMPONENT_NAME` and is not a catalog name ignoring case (refuse `button` and `Markup`).
   - **Description:** 1 to 300 characters of plain text with no control characters.
   - **Category and children:** category is `layout`, `text`, `input` or `display`; children is `none` or `any`.
   - **Schema and example:** `propsSchema` and `exampleProps` pass `catalogEntryProblems`.
   - **Size:** `JSON.stringify(definition)` is at most 8,000 characters.
   - **Template shape:**
     - nodes are `{ component, props?, children? }`;
     - at most 40 nodes and 6 levels, with a custom node counting as one;
     - `{ "$prop": n }` only as a whole prop value or a Markup text, attribute or style value, and `n` must be declared in `propsSchema.properties`.
   - **Slot:** `{ "$children": true }` only inside a `children` array, at most once. Refused when children is `none`; required when children is `any`.
   - **References:**
     - every non-catalog component name must resolve to a component that isn't deleted;
     - nesting through current versions is at most 3 levels;
     - a reference that leads back to the definition's own name is refused, naming the loop.
   - **Example check:** finally, expand the template as an instance with `exampleProps` and no children, resolving the definition's own name to the candidate. Then run `validateUiTree` on the result with `actions`, `{ designChecks: false, maxNodes: 400, maxDepth: 24 }`, and report problems with paths rewritten to `template…`. This catches catalog prop errors, Markup problems and unregistered actions at definition time.
4. Both functions are pure apart from `resolve`: no logging of definitions, no storage writes.

## Acceptance

- `validateDefinition` accepts:
  - a valid composed definition (a `MenuItemCard` of `Card`, `Image`, `Heading` and `Badge` with `$prop`s);
  - a valid Markup definition (an SVG `BarChart`);
  - a wrapper with a `$children` slot;
  - a definition that uses an existing custom component.
- It refuses each rule in Scope item 3 with a path-specific message: bad name, catalog name in any case, long description, invalid schema, `exampleProps` not matching, oversize, undeclared `$prop`, misplaced or duplicate slot, slot with children `none`, missing slot with children `any`, unknown or deleted reference, fourth nesting level, self-reference loop, a Button `action` that isn't registered, and a Markup `script` tag.
- `expandTree` returns only catalog components:
  - it fills props, uses schema defaults, leaves out unset optional props, splices children into the slot, and expands nested custom components;
  - it refuses bad instance props and children with agent-tree paths;
  - it refuses a deleted component at the top level but expands one used inside a template;
  - it stops with an error, not a hang, on a loop that appears through an update.
- `rewritePaths` turns an expanded-tree message into the `tree.children.0 (MenuItemCard v3) template…` form, and maps spliced children back to the agent's paths.
- `validateCatalog` output is unchanged for the real catalog and existing tests.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including new `server/customComponents/definition.test.ts` and `server/customComponents/expand.test.ts`, which use the real `catalog` (through `InMemoryComponentRepository` or the array directly) and a `resolve` backed by `InMemoryCustomComponentRepository` from `server/ports/fakes`.
- `npm run build:api` passes.
