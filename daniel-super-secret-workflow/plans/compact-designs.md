# Compact designs for long lists

## Overview

Today a generated design draws a long list as one column, often one Card per entry, so "show me all the menu items" becomes a long scroll on a phone. The catalog (`server/catalog/components.ts`) has nothing that shows part of a design at a time. The model also sees item names but not their categories (`server/actions/menu/choices.ts`), so it can't split the menu sensibly.

After this change a long list arrives split by its groups. Two new catalog components make this possible. `Tabs` shows one panel at a time, behind a tab bar or, past four labels, a "Show" dropdown. `Collapsible` is a titled section that opens and closes. The sandbox draws both with keyboard support at WCAG 2.2 AA. They keep switching in a Done or replaced design, since they only change what is shown. The context lists menu items grouped by category, beside the existing flat values, so current dropdowns are unaffected. The prompt asks for one line per entry rather than a Card each, Tabs by group past 8 entries, shorter lists left whole, and each form kept inside one tab or section. A new check refuses a form whose button sits outside the tab or section holding its inputs, because the page won't send a field the person can't see.

The catalog and renderer land together first: `src/sandbox/componentNames.test.ts` fails when they differ. The checks and the grouping then run in parallel, and the prompt rule, eval cases and docs come last. The main risk is Tabs where a flat list was better. Two eval cases test each side of the threshold. "Custom component" in the request is read as the generated design, not a saved custom component.

## Shared

`Tabs` takes `labels`, 2 to 20 unique non-empty strings, and exactly one child per label in the same order; each child is one panel. `Collapsible` takes a required `title` and an optional `open` (default false) and any children, which make up its content. Both are `layout` components with `children: "any"`. A Tabs panel is the subtree at `<tabsPath>.children.<i>`; a Collapsible's content is everything under its own path. Those subtrees are the only places a design hides content.

## Work breakdown

| Slice | Covers | Touches | After | Size |
| --- | --- | --- | --- | --- |
| components | Tabs and Collapsible in the catalog and sandbox | server/catalog/components.ts, server/catalog/components.test.ts, server/catalog/validate.test.ts, src/sandbox/components.ts, src/sandbox/componentNames.ts, src/sandbox/tabs.ts, src/sandbox/tabs.test.ts, src/chat.ts, src/style.css | - | medium |
| checks | Tabs label count and forms split across hidden panels | server/ui/validateTree.ts, server/ui/validateTree.test.ts, server/ui/bindings.ts, server/ui/bindings.test.ts, server/generate/checkDesign.test.ts | components | medium |
| grouping | grouped dropdown values in the generator context | server/actions/types.ts, server/actions/registry.ts, server/actions/registry.test.ts, server/actions/menu/choices.ts, server/actions/menu/menu.test.ts, server/generate/context.ts, server/generate/context.test.ts, server/generate/generate.ts, server/routes/generate.ts, server/eval/runner.ts | - | medium |
| prompt | compact-design rule, eval cases, docs | server/generate/prompt.ts, server/generate/prompt.test.ts, server/eval/cases/large-list-tabs.json, server/eval/cases/short-list-flat.json, docs/ARCHITECTURE.md | components, checks, grouping | small |

## components

Adds `Tabs` and `Collapsible` to `catalog` in `server/catalog/components.ts` (passing `validateCatalog`: a `description` on every prop, valid `exampleProps`), to `RENDERED_COMPONENTS`, and as renderers in `src/sandbox/components.ts`. Pure tab logic (which mode a label count gets, which tab an arrow key moves to) lives in a new `src/sandbox/tabs.ts` with unit tests in a new `src/sandbox/tabs.test.ts`, since the test runner has no DOM.

Tabs with up to 4 labels draws a WAI-ARIA tab bar: `role="tablist"`, one `role="tab"` button per label with `aria-selected` and `aria-controls`, roving `tabindex`, Left/Right wrapping, Home/End, and selection following focus. Each panel is `role="tabpanel"`, labelled by its tab, and inactive panels carry `hidden`. The bar scrolls sideways rather than wrapping when it overflows a phone width. With 5 or more labels it draws a labelled "Show" `<select>` of the labels instead. The first panel shows at start. The renderer reads defensively: a child without a label is not drawn, and a label without a child shows an empty panel.

Collapsible draws a native `<details>` with the title in its `<summary>`, open when `open` is true.

The tab buttons and the "Show" select have no `name` and no `data-path`, so they are never read as fields, and they carry a marker that `disableControls` in `src/chat.ts` skips. Every other control is still disabled exactly as before.

- `npm test` passes, including `src/sandbox/componentNames.test.ts` and the new `src/sandbox/tabs.test.ts` (mode threshold at 4/5 labels, arrow keys wrap at both ends, Home/End).
- `npm run typecheck` and `npm run build` pass.
- In the preview page or the Components panel preview, a 3-label Tabs shows one panel. Clicking a tab or using the arrow keys switches panels, and a screen reader announces tab name, position and selection.
- A 6-label Tabs shows a "Show" dropdown, and choosing a label shows that panel only.
- A Collapsible opens and closes by mouse and by Enter/Space on its title, and starts open when `open` is true.
- After a Card's action succeeds (Done) or a newer design replaces this one, its tabs still switch and its sections still open, while its inputs and action buttons stay disabled.
- Clicking an action button sends no value for a tab button or the "Show" select.
- At 375px wide, a Tabs with 4 long labels causes no horizontal page scroll.

## checks

Two design problems are added to `validateUiTree` in `server/ui/validateTree.ts`. They run for designs and for custom component templates, and they report like the existing ones, with paths and within `MAX_ERRORS`.

- **Label count:** a Tabs node whose children count differs from its `labels` count is refused, with a message that gives both numbers and asks for one child per label. This runs only when its props are otherwise valid, the way `selectValueProblems` does.
- **Split form:** for each enabled action Button or Markup `button`, every named input it sends (`sendsInput`) that sits inside a Tabs panel or a Collapsible must have that button inside the same panel or Collapsible. Check every such ancestor, not only the nearest. The problem names the input's path and the button's action and path, and says to put the form's inputs and its button in the same tab or section. Any panel ancestry that `collectBindings` needs to record goes in `server/ui/bindings.ts`.

- A Tabs with 3 labels and 2 children is refused. With 3 and 3 it passes.
- A design whose Card wraps a Tabs, with inputs in the panels and the Card's button outside the Tabs, is refused naming each hidden input.
- A Tabs whose every panel holds its own Card with its inputs and button passes `checkDesign`.
- A Collapsible holding an input whose button is outside it is refused, whether or not `open` is true.
- An input in a Collapsible nested in a Tabs panel, with its button in the panel but outside the Collapsible, is refused.
- A disabled button, and a button that doesn't send the hidden input, produce no split-form problem.
- `npm test` passes.

## grouping

Adds an optional `listGroups(signal)` to `ChoiceSource` in `server/actions/types.ts`. It returns an ordered list of `{ name, values }` groups. `createActionRegistry` gains `listChoiceGroups(source, signal)`, which resolves to the groups, or `undefined` for a source without them, and rejects for an unknown source like `listChoices`. The `menu_items` source in `server/actions/menu/choices.ts` groups items by category name: categories and the items within each sorted by folded name, archived items included as in `list`, and items without a category in a last group named "No category".

`buildContext` takes an optional `listChoiceGroups` (passed through `GenerateDeps`, by the generate route and the eval runner). For a source with groups, the "Dropdown values by source" entry keeps `values` and `truncated` exactly as today and adds `groups`, covering exactly the listed values (at most `MAX_CHOICES`). `checkDesign` and the action route are unchanged.

- With the fixture menu, the context's `menu_items` entry has a "Cà phê" group holding "Cà phê sữa đá" and "Cà phê đen đá", and every listed value appears in exactly one group.
- When a source has more than 50 values, its groups name only the 50 listed ones.
- Sources without groups are listed byte-for-byte as before.
- A `listGroups` that rejects is logged by source name only. That source is listed with its values and no groups, and the generation goes on.
- `listChoiceGroups` rejects for an unknown source and resolves `undefined` for `menu_categories`.
- `npm test` and `npm run typecheck` pass.

## prompt

Adds a compact-design rule to `GENERATE_SYSTEM_PROMPT` in `server/generate/prompt.ts`:

- Show each entry of a list on one line (a Markup list or table) rather than one Card each, unless each entry needs its own form.
- When a design would show more than 8 entries and they fall into groups (the groups listed with a dropdown source, or groups the request gives), split them with Tabs: one tab per group, labelled with the group names in their listed order. Keep 8 or fewer entries in one piece, and a list without groups as one compact list.
- Use Collapsible, closed, for extra details a person needs only sometimes.
- Put each form, with its button, inside one tab or section, in its own Card.

Adds two eval cases. `large-list-tabs` puts about 24 items in 4 named groups in its prompt and expects `Tabs` and an item from the last group. `short-list-flat` gives 5 items in 2 groups and expects neither `Tabs` nor `Collapsible`. Updates `docs/ARCHITECTURE.md`: the catalog count and list (§5), the renderer's tabs and sections and their lock behaviour (§2), the two new design checks (§4), grouped dropdown values in the context (§4), and the eval case count (§10).

- `npm test` passes, including `server/eval/cases.test.ts` for both new cases and `server/generate/prompt.test.ts` for the new rule.
- `docs/ARCHITECTURE.md` describes `Tabs` and `Collapsible`, the split-form and label-count checks, and grouped dropdown values, and no longer says only `Stack` and `Card` take children.

## After merge

- After `npm run db:seed`, the seed prints 2 added, and generating works with the new components.
- With `OPENAI_API_KEY`, `npm run eval -- --case large-list-tabs --case short-list-flat --repeat 5` passes at least 4 of 5 runs for each case.
- A full `npm run eval` has no case failing that passed on `main`, especially the menu cases that build dropdowns (`edit-item-preset`, `per-item-edit-cards`, `menu-create-item`).
- In the preview page, after adding menu items until there are more than 8, "Show me every menu item" draws Tabs labelled by category on a phone-width window.
