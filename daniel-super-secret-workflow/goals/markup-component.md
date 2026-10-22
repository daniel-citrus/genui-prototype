---
id: markup-component
priority: 20
depends: []
touches:
  - shared/markup.ts
  - server/catalog/components.ts
  - server/catalog/validate.test.ts
  - server/ui/markup.ts
  - server/ui/markup.test.ts
  - server/ui/validateTree.ts
  - server/ui/validateTree.test.ts
  - server/ui/bindings.ts
  - server/ui/bindings.test.ts
  - server/ui/checkAction.test.ts
  - src/sandbox/markup.ts
  - src/sandbox/markup.test.ts
  - src/sandbox/components.ts
  - src/sandbox/componentNames.ts
scope: large
---

# Add a Markup building block that draws allowlisted HTML and SVG

## Sources

- [Custom components plan: R5, R6, R7, Design (Interfaces, allowlist)](../plans/custom-components.md#r5-markup-building-block)

## Context

The agent will soon define custom components (later goals). When nothing in the catalog can draw what a request needs (a bar chart, a star rating), a custom component will use a new catalog component, `Markup`, whose `root` prop is a JSON tree of allowlisted HTML and SVG elements. There is no JavaScript and never an HTML string. This goal adds `Markup` end to end: the shared allowlist, server validation, binding collection so buttons inside it can only run registered actions, and the browser renderer. A later goal (`custom-component-render`) makes `render_ui` refuse `Markup` placed directly in a design; until then `render_ui` accepts it like any catalog component.

Relevant code today:

- `server/catalog/components.ts` exports 12 components; `server/catalog/validate.ts` (`validateCatalog`) checks every entry; `server/catalog/validate.test.ts` asserts `catalog.length` is 12.
- `server/ui/validateTree.ts` (`validateUiTree(tree, catalog, actions?, choiceValues?)`) checks node shape, catalog names, props against each `propsSchema`, children, `MAX_DEPTH` 8 and `MAX_NODES` 100, and bindings: duplicate input names, unregistered Button actions, required action inputs, input kinds, password fields, dropdown sources, and `edit` forms with nothing to change.
- `server/ui/bindings.ts` (`collectBindings`) returns `NamedInput`s (`component: "TextInput" | "Checkbox" | "Select"`, `name`, `type`, `options`, `path`) and `ActionButton`s (`action`, `disabled`, `path`) from catalog nodes.
- `server/ui/checkAction.ts` (`checkActionRequest`) accepts a click only when `collectBindings` finds an enabled button for the action in the remembered design and every value fits a named input.
- Browser: `src/sandbox/render.ts` draws a tree through one renderer per name in `src/sandbox/components.ts` (`components: Record<RenderedComponentName, Renderer>`), names listed in `src/sandbox/componentNames.ts` (`RENDERED_COMPONENTS`); `src/sandbox/componentNames.test.ts` fails if they differ from the catalog. Renderers never use `innerHTML`. A Button gets `data-action` only when enabled with a snake_case action (`/^[a-z][a-z0-9_]*$/`). `src/main.ts` sends clicks on `button[data-action]` in the sandbox with the values of every named `input` and `select` there (`readFields`, `src/sandbox/actionValues.ts`): checkboxes send `checked`, others their value; it runs `checkValidity` first.
- Tailwind only builds classes found in the source, so Markup uses inline style properties, never class names.

## Scope

1. `shared/markup.ts` (new), imported by both server and browser:
   - `MarkupElement`: `{ tag: string; attrs?: Record<string, string | number | boolean | { $prop: string }>; style?: Record<string, string | { $prop: string }>; text?: string | { $prop: string }; action?: string; children?: MarkupElement[] }`.
   - `MAX_MARKUP_ELEMENTS = 200`, `MAX_MARKUP_DEPTH = 12`, `MAX_MARKUP_TEXT_CHARS = 1000`.
   - `MARKUP_HTML_TAGS` and `MARKUP_SVG_TAGS`: tag → allowed attributes.
     - HTML tags: `div`, `span`, `p`, `strong`, `em`, `small`, `br`, `hr`, `h1`, `h2`, `h3`, `h4`, `ul`, `ol`, `li`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `caption`, `label`, `input`, `select`, `option`, `button`, `img`, `figure`, `figcaption`, `progress`, `meter`, `svg`. Every HTML tag allows `title` and `aria-label`. Additionally:
       - `th` and `td`: `colspan`, `rowspan`.
       - `img`: `src`, `alt`, `width`, `height`.
       - `input`: `name`, `type`, `placeholder`, `min`, `max`, `step`, `value`, `checked`, `disabled`, `maxlength`.
       - `select`: `name`, `disabled`.
       - `option`: `value`, `selected`.
       - `button`: `disabled`.
       - `progress`: `value`, `max`.
       - `meter`: `value`, `min`, `max`.
       - `svg`: `viewBox`, `width`, `height`.
     - SVG tags (only inside `svg`): `g`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path`, `text`, `tspan`, `title`, each with the geometry and paint attributes that apply: `x`, `y`, `x1`, `y1`, `x2`, `y2`, `cx`, `cy`, `r`, `rx`, `ry`, `width`, `height`, `points`, `d`, `fill`, `stroke`, `stroke-width`, `transform`, `text-anchor`, `font-size`, `opacity`.
   - `MARKUP_STYLE_PROPERTIES`:
     - text: `color`, `background-color`, `font-size`, `font-weight`, `font-style`, `font-family`, `text-align`, `text-decoration`, `line-height`, `letter-spacing`, `white-space`, `vertical-align`;
     - box: `padding`, `margin` and their `-top`, `-right`, `-bottom`, `-left` forms, `border`, `border-top`, `border-right`, `border-bottom`, `border-left`, `border-color`, `border-width`, `border-style`, `border-radius`, `box-sizing`, `overflow`, `opacity`;
     - size: `width`, `height`, `min-width`, `max-width`, `min-height`, `max-height`;
     - layout: `display` (only `block`, `inline`, `inline-block`, `flex`, `grid`, `none`), `flex-direction`, `flex-wrap`, `flex`, `flex-grow`, `flex-shrink`, `flex-basis`, `align-items`, `justify-content`, `align-self`, `gap`, `row-gap`, `column-gap`, `grid-template-columns`, `grid-template-rows`, `grid-column`, `grid-row`;
     - SVG paint: `fill`, `stroke`, `stroke-width`.

     There is no `position`, `z-index` or `transform`.
   - `MARKUP_INPUT_TYPES`: `text`, `email`, `number`, `date`, `time`, `url`, `tel`, `checkbox`, `range` (no `password`, `radio`, `file`, `hidden`).
   - `markupValueProblem(value: string): string | undefined`: refuses more than 200 characters, or containing (ignoring case) `url(`, `expression`, `javascript:`, `@`, `\`, `<` or `>`.
   - `isSafeImageSrc(value: string): boolean`: only absolute `http:` or `https:` URLs.
2. `server/ui/markup.ts` (new): `validateMarkup(root: unknown, path: string): string[]`, one message per problem, with paths like `tree.children.0.props.root.children.2.attrs.onclick is not allowed`. It refuses:
   - unknown keys, tags outside the allowlist, SVG tags outside an `svg`, HTML tags inside an `svg`;
   - attributes not allowed on that tag (so `on*`, `href`, `id`, `class`, `style` as an attribute, `xlink:href` are all refused), style properties outside the list, and values failing `markupValueProblem`;
   - `img` `src` failing `isSafeImageSrc`, an `input` `type` outside `MARKUP_INPUT_TYPES`, and `maxlength` above 1000;
   - `action` on anything but `button`, or not snake_case; `text` over 1000 characters, or on `input`, `select`, `img`, `br`, `hr`;
   - any `{ "$prop": ... }` object left in the tree ("placeholder not filled"), and more than 200 elements or 12 levels.
3. `server/catalog/components.ts`: add `Markup` (category `display`, children `none`, `propsSchema` with one required `root` property of type `object` and a description saying it is only used inside custom component templates, `exampleProps` with a small SVG bar). Update `server/catalog/validate.test.ts` to 13 components.
4. `server/ui/validateTree.ts`:
   - For a `Markup` node, add `validateMarkup(props.root, `${path}.props.root`)`. Markup elements do not count toward the node and depth limits.
   - Add an optional fifth parameter `options?: { designChecks?: boolean; maxNodes?: number; maxDepth?: number }`. `designChecks: false` skips the "action needs an input named …" and "changes nothing without an input" checks. `maxNodes` and `maxDepth` default to today's 100 and 8. Later goals use these.
5. `server/ui/bindings.ts`: `collectBindings` also walks every `Markup` node's `root`:
   - `input` with a string `name`: `Checkbox` when `type` is `checkbox`, else `TextInput` with its `type` (default `text`);
   - `select` with a string `name`: `Select`, whose options are each `option` child's `attrs.value`, or its `text` when there is no value;
   - `button` with a string `action`: an `ActionButton`, disabled when `attrs.disabled === true`.

   Paths continue the tree path (`tree.children.0.props.root.children.1`). `checkActionRequest` then covers Markup with no change.
6. Browser:
   - `src/sandbox/markup.ts` (new): `filterMarkup(root: unknown): MarkupElement | null`, a pure function that drops anything outside the shared allowlist, applying the same rules as the server, so it is testable without a DOM. `drawMarkup(root: unknown): HTMLElement` filters, then builds the elements:
     - `document.createElement`, or `createElementNS("http://www.w3.org/2000/svg", …)` for `svg` and its descendants;
     - `setAttribute` per allowed attribute, `style.setProperty` per allowed property, `textContent` for text; never `innerHTML`;
     - an `input` or `select` gets its `name`; a `button` gets `data-action` only when its action is snake_case and it isn't disabled.
   - The result is wrapped in a `div` with `contain: content` and `overflow: hidden`.
   - Add `Markup` to `RENDERED_COMPONENTS` and a `Markup` renderer in `src/sandbox/components.ts` that calls `drawMarkup(props.root)`.

## Acceptance

- `validateMarkup` refuses each case in Scope item 2 with a path-specific message, and accepts a valid SVG bar chart and a valid form (a text input, a select and a button with an action).
- `validateUiTree` reports Markup problems for a `Markup` node. Markup elements don't count toward the node limit. `designChecks: false` and custom `maxNodes`/`maxDepth` behave as described. With no options, every existing `validateTree.test.ts` case passes unchanged.
- In a tree with a `Markup` node, `collectBindings` finds its named inputs, selects (with options) and action buttons. `validateUiTree` with actions refuses a Markup button naming an unregistered action, a duplicate input name across a catalog input and a Markup input, and a Markup checkbox filling a string property.
- `checkActionRequest` accepts a click for an enabled Markup button with fitting values, and refuses a disabled Markup button and values for unknown names.
- `filterMarkup` drops a `script` element, an `onclick` attribute, a `background: url(...)` style, a `javascript:` image src and a password input. It keeps allowed elements unchanged.
- The catalog has 13 valid entries. `componentNames.test.ts` passes, and the seed would add `Markup` (via `seedComponents`) with no other change.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including new `server/ui/markup.test.ts` and `src/sandbox/markup.test.ts`, plus new cases in `server/ui/validateTree.test.ts`, `server/ui/bindings.test.ts`, `server/ui/checkAction.test.ts` and `server/catalog/validate.test.ts`.
- `npm run build` and `npm run build:api` pass.

## After merge

- Run `npm run db:seed` and check it reports `Markup` added.
- Look at a design with a Markup bar chart and a Markup form in the sandbox, and check that clicking the form's button sends its values and nothing in the Markup can cover the chat.
