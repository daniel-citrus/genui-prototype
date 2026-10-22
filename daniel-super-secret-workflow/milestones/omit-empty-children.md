---
id: omit-empty-children
priority: 30
depends: []
touches:
  - server/ui/omitEmptyChildren.ts
  - server/ui/omitEmptyChildren.test.ts
  - server/ui/validateTree.ts
  - server/ui/validateTree.test.ts
  - server/customComponents/expand.ts
  - server/customComponents/expand.test.ts
  - server/customComponents/definition.ts
  - server/customComponents/definition.test.ts
  - server/agent/tools/ui.ts
  - server/agent/tools/ui.test.ts
  - server/agent/tools/customComponents.test.ts
  - docs/ARCHITECTURE.md
scope: medium
---

# Drop an empty children array on a leaf

## Sources

- [Eval improvements — R1](../plans/eval-improvements.md#r1-empty-children-on-a-leaf)

## Context

`validateUiTree` in `server/ui/validateTree.ts` reports `cannot have children` whenever `children` is present on a catalog component whose `children` is `"none"`, including an empty array. Only `Stack` and `Card` in `server/catalog/components.ts` have `children: "any"`. Heading, Text, Button, Divider, Checkbox, Select, Alert, Image, Badge, and Markup are `"none"`.

`expandCustom` in `server/customComponents/expand.ts` does the same for a custom instance (`tree PromoBanner cannot have children`) and leaves that node out of the expanded tree. The test "refuses bad instance props and children with the agent's paths and leaves the node out" in `server/customComponents/expand.test.ts` passes `MenuItemCard` (from `server/customComponents/testDefinitions.ts`, `children: "none"`) with `children: []` and expects that error. `MenuItemCard` with props `{ name: "Latte", price: "$4.50", photo: "https://example.com/latte.jpg" }` otherwise expands to a `Card` with empty props and three children: an `Image` (`src` the photo, `alt` `"Latte"`), a `Heading` (`text` `"Latte"`, `level` 3), and a `Badge` (`text` `"$4.50"`, `tone` `"success"`).

`validateDefinition` in `server/customComponents/definition.ts` expands the template with `exampleProps` and runs the same tree check. On success it returns the definition object it was given. `define_component` in `server/agent/tools/customComponents.ts` builds that object with `template: args.template` and saves `check.definition`, so the saved template is the same object as the tool arguments' template unless `validateDefinition` returns a copy.

`render_ui` in `server/agent/tools/ui.ts` validates and shows `design.tree`. With a custom-component repository it shows the expanded tree from `expandDesign`. Without one it shows `args.tree`. `showUi` receives that tree. The model's tool arguments stay on the trace as `call.args`.

An empty array means length 0. The key is dropped only when that component's `children` is `"none"`. The trace keeps the model's arguments. The sandbox and the saved template store the stripped copy. Rows already stored with `children: []` on a leaf are not rewritten. `get_component` keeps returning the stored template until something saves that name again. The next `render_ui` drops the key on the expanded tree before showing it.

## Scope

Add this pure function in `server/ui/omitEmptyChildren.ts`:

```ts
export function omitEmptyChildren(
  node: unknown,
  childrenOf: (name: string) => "none" | "any" | undefined,
): unknown
```

It returns a new value and does not mutate `node`. For an object with a string `component`, when `children` is an array of length 0 and `childrenOf(component)` is `"none"`, the copy has no `children` key. A non-empty `children` array is copied element by element, so a leaf nested under a `Stack` is stripped too. `props` is copied by reference and is not walked. Any other value is returned unchanged, so a node that needs no change may be the same reference. `children: []` on an unknown name stays, because `childrenOf` returns `undefined` and that name is not treated as `"none"`. `children: [null]` and any one-element array are non-empty. A `{$children: true}` slot is an object inside the array, so the array is not empty and the existing slot rule is unchanged.

`childrenOf` for `render_ui` reads the catalog and returns `undefined` for any other name. `render_ui` validates and shows the returned copy, never `args.tree` itself. Do this after `expandDesign` when custom components are wired, and on a copy of `args.tree` when they are not. Stripping the expanded tree is what removes an empty `children` array on a catalog leaf that came from a template already stored that way.

`childrenOf` for `validateDefinition` is a map built after reference resolution: every catalog name, every resolved custom component that is not deleted, and the definition's own name mapped to its own `children`. The stripped template is what `expandTree` receives inside the example check and what the successful return value stores. Because `define_component` passes `template: args.template`, return a definition whose `template` is that copy and leave the object passed in unchanged. A definition that fails for another reason saves nothing.

In `expandCustom`, an array of length 0 when `custom.children === "none"` is treated as absent: no children error, and the slot source is empty. Do not mutate the agent's node. A non-empty array when `children` is `"none"` still pushes `cannot have children` and returns `undefined`, so that node is left out. A non-array `children` value still fails with `children must be an array`.

`validateUiTree` reports no `cannot have children` error for an empty array on a `"none"` component, and it does not delete the key on its input. A non-empty array on a `"none"` component still fails. A non-array `children` value still fails. A `Stack` or `Card`, or a custom component with `children: "any"`, keeps `children: []`. An unknown name is not treated as `"none"`, and the unknown-component error still reports it.

The UI trees bullet in `docs/ARCHITECTURE.md` (the paragraph that starts with **UI trees.**) gains this sentence: an empty children array on a component whose children is none is removed before the check, and the tree that is shown or saved has no children key.

Leave the output-token cap, stored custom-component rows, and `npm run eval` in CI as they are. A `{$children: true}` slot when the definition says `children` is `"none"` still fails, which `server/customComponents/definition.test.ts` already covers.

## Acceptance

- `render_ui` of a Heading with `text` and `children: []` succeeds, and the tree passed to `showUi` has no `children` key. The arguments object still has that key.
- A custom component saved with `children: "none"`, rendered with `children: []`, expands and is shown. A non-empty `children` array on that instance still fails with `cannot have children` and nothing is shown.
- `define_component` whose template has a Heading with `children: []` saves, and the stored template has no `children` key on that Heading. The arguments object still has the key. A Heading with a real child still fails and nothing is saved.
- `validateUiTree` of a Heading with `props: { text: "Hello" }` and `children: []` reports no children error, and the input still has the key. A Button whose child is a Button still reports `cannot have children`. A Stack with `children: []` still has that array.
- `omitEmptyChildren` does not mutate its input. A Heading loses an empty `children` array. A Stack keeps `children: []`. An unknown component name keeps `children: []`. A Markup node's `props.root` is the same reference, children inside that root included. A non-empty `children` array is copied element by element.
- The `expandTree` test that passes `MenuItemCard` with `children: []` no longer reports `cannot have children`. Its result tree is a Stack whose children are that card's expansion (the Card, Image, Heading, and Badge described above) and then `{ component: "Text", props: { text: 5 } }`. The other errors in that test stay: the bad `MenuItemCard` props at `tree.children.0`, and the `Panel` shape errors at `tree.children.2`. The rewritten text error stays `tree.children.3.props.text must be string`. The input node still has `children: []`. A non-empty `children` array on `MenuItemCard` still reports `cannot have children` and that node is absent from the result.
- A `{ "$children": true }` slot when the definition says `children` is `"none"` still fails.

## Validation

- `npm test` exits 0. It includes the new `server/ui/omitEmptyChildren.test.ts` and the updated tests in `server/ui/validateTree.test.ts`, `server/customComponents/expand.test.ts`, `server/customComponents/definition.test.ts`, `server/agent/tools/ui.test.ts`, and `server/agent/tools/customComponents.test.ts`.
- `npm run typecheck` exits 0.
