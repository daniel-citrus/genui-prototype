---
id: markup-hardening
priority: 30
depends:
  - markup-component
  - custom-component-store
touches:
  - shared/markup.ts
  - server/ui/markup.ts
  - server/ui/markup.test.ts
  - src/sandbox/markup.test.ts
  - src/main.ts
  - server/ports/CustomComponentRepository.ts
  - server/ports/fakes/InMemoryCustomComponentRepository.ts
  - server/ports/fakes/customComponentRepositoryCases.ts
  - server/adapters/db/DrizzleCustomComponentRepository.ts
scope: medium
---

# Close the hidden-input, CSS function and restore-limit gaps

## Sources

- [Custom components plan: R1, R5, R6, R7, Security](../plans/custom-components.md#security)
- Merge reviews of PRs #43 and #44 on `custom-components` (findings carried into this goal).

## Context

Custom components can draw with `Markup`, a JSON tree of allowlisted HTML and SVG elements. One rule walker, `sanitizeMarkup(root, path, report?)` in `shared/markup.ts`, enforces the allowlist on both sides: on the server it backs `validateMarkup` in `server/ui/markup.ts`, and in the browser it backs `filterMarkup` in `src/sandbox/markup.ts`. The rules cover:
- **Tags and attributes:** allowed tags, attributes per tag and style properties.
- **Style values:** `markupValueProblem` refuses `url(`, `expression`, `javascript:`, `@`, `\`, `<` and `>`.
- **Positioning:** no `position`, `z-index` or CSS `transform`.
- **Input types:** no password, hidden, radio or file inputs.

The browser draws Markup in `src/sandbox/components.ts` inside a wrapper with `contain: content` and `overflow: hidden`. Named `input` and `select` elements and action `button`s inside Markup behave like catalog inputs and Buttons: `collectBindings` finds them, and `checkActionRequest` checks clicks against them. On a click, `src/main.ts` (`sendAction`, `readFields`) sends the value of every named `input` and `select` in the sandbox.

The merge reviews found three gaps:

1. **Invisible pre-filled inputs.** A Markup input can carry a preset `value` and be hidden with `display: none`, `opacity: 0`, a zero size, or a negative margin that the wrapper clips. Its value is then sent with a click the person makes, though they never saw it. A hidden `select` sends its first or selected option the same way. Custom components are global and their buttons can run any registered action, such as `menu_set_size_price`, so one bad or prompt-injected component could quietly send values. Catalog components can't be hidden, because they have no style control.
2. **CSS functions.** `src(`, a newer form of `url(`, and image functions such as `image-set(` are not refused. The allowed properties can't load anything through them in current browsers, so this is future-proofing.
3. **Restore limit.** `CustomComponentRepository.save` refuses a 201st active component (`assertCanCreate` in `server/ports/CustomComponentRepository.ts`), but `restore` doesn't check that limit, so restoring deleted components can push the active count past 200.

The Components panel route (goal `custom-components-panel`, running in parallel) already maps a `CustomComponentError` with code `limit` from `restore` to 409. This goal only makes `restore` throw it.

## Scope

1. **Hidden controls (`shared/markup.ts`, used by both server and browser).** A "control" is a named `input` or `select`, or a `button` with an `action`. On a control, or on any element that contains one, refuse the following:
   - `display: none`;
   - `opacity` below `0.5`;
   - `width`, `height`, `max-width` or `max-height` of zero (`0`, `0px`, `0%`, `0em` and similar);
   - any negative margin (`margin` or `margin-top`, `-right`, `-bottom`, `-left` containing a negative length);
   - `font-size` of zero.

   The same styles stay allowed on elements with no control inside, such as decorative SVG and text.

   The server reports each case with a path such as `….children.0.style.display hides a field that sends a value`. The browser's `filterMarkup` drops the offending style property, so the control stays visible.
2. **CSS functions (`markupValueProblem`).** Refuse any function call in a style or attribute value except `rgb`, `rgba`, `hsl`, `hsla`, `calc`, `min`, `max`, `clamp`, `repeat`, `minmax` and `fit-content`. Match any identifier followed by `(`, in any letter case. The existing refusals stay, so `url(` is still refused with its own message.
3. **Browser click guard (`src/main.ts`).** Before sending an action, find any named `input` or `select` in the sandbox that the person can't see: `checkVisibility({ opacityProperty: true, visibilityProperty: true })` is false, or its bounding box has zero width or height. If there is one, send nothing and show the failed status "This design has a hidden field, so the action was not sent." Catalog designs are unaffected, because their inputs are always visible.
4. **Restore limit.** `restore(name)` in both `InMemoryCustomComponentRepository` and `DrizzleCustomComponentRepository` rejects `CustomComponentError` with code `limit` when restoring would make more than 200 components active. Use the same message as `assertCanCreate`, through a shared helper on the port. In Drizzle, run the count check and the update in one transaction, under the same advisory lock `save` takes for creation. Restoring a component that isn't deleted still resolves `true` without changes, and an unknown name still resolves `false`. Add the cases to `server/ports/fakes/customComponentRepositoryCases.ts` so both repository tests run them.

## Acceptance

- `validateMarkup` refuses each hiding style from Scope 1 on a control or on any ancestor of one, with a path-specific message.
- It still accepts the same styles on elements with no control inside, and every existing Markup test still passes.
- `filterMarkup` removes those styles from controls and their ancestors and leaves everything else as it was.
- `markupValueProblem` refuses `src(…)`, `image-set(…)`, `image(…)`, `element(…)`, `cross-fade(…)`, `var(…)` and `attr(…)` in any letter case. It accepts the allowed functions and plain values such as `#1f2937`, `12px` and `1fr 2fr`.
- In the browser, if a design whose named input is hidden (for example by a parent's `display: none`) reaches the sandbox anyway, such as when drawn directly on a test page, clicking its button sends no action and shows the hidden-field message. A normal catalog form and a normal Markup form still send their values.
- `restore` refuses with code `limit` at 200 active components in both repositories. It succeeds below the limit, and keeps its existing results for components that aren't deleted and for unknown names.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including new cases in `server/ui/markup.test.ts`, `src/sandbox/markup.test.ts` and `server/ports/fakes/customComponentRepositoryCases.ts`. The Drizzle cases skip without `DATABASE_URL`; to run them, use a throwaway database such as `genui_worker3` in the local `genui-prototype-db-1` container and drop it afterwards, never the dev `genui` database.
- `npm run build` and `npm run build:api` pass.
- Browser check with Vite on port 5923 (as the `markup-component` worker did with Playwright): draw a Markup form with a visible named input and one hidden by a parent, and check that clicking its button shows the hidden-field message and sends no request. Also check that a normal form still sends.

## After merge

- In the running app, ask the agent for a custom component form, and check that a normal Save click still sends its values and that no field is hidden.
