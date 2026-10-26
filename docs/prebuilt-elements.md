# Pre-built elements: open questions

Open questions and build order for the [pre-built elements proposal](https://claude.ai/artifact/3U76pP9GDAn9S9i4vWzRaQ), which adds 14 saved custom components for action forms: 8 critical ones (`ActionCard`, `DangerActionCard`, five dropdown pickers and `PriceField`) and 6 helpful ones. The proposal itself, with each element's props and the action-by-action coverage, stays in that doc. `OptionListField` and `PickLimitField` serve the modifier-group actions on the `add-modifier-group-actions` branch.

Related: [Architecture](ARCHITECTURE.md)

## Build order

Nothing can add a custom component today: there is no create route, and the seed only writes the catalog table. That has to change before any of these elements can ship.

1. **Seed path.** Commit the definitions to a file and save them through `validateDefinition` and the repository on start, the way the catalog seed works.
2. **Critical elements.** Build the eight critical elements, with eval cases that check each one is chosen (for example "change the price of Bạc xỉu L" expects `SizePicker` and `PriceField`).
3. **Prompt rule.** Tell the model to prefer a saved element made for an action's form. Today the prompt says catalog components first, so it may ignore them.
4. **Helpful fields.** `OptionListField`, `PickLimitField`, `ToggleField` and `ImageUrlField`.
5. **Summaries.** `ItemSummary` and `ModifierGroupSummary`, once the host agent sends current prices and options.

## Open questions

- **Seeded or managed?** A seed that runs on every start would bring back an element someone deleted or reverted in the Components panel. Should seeded elements be read-only, or should the seed only add missing ones?
- **Five pickers or one?** Five keep each name and label fixed. One generic picker with a `source` prop is fewer listings, but the context already has room: it lists up to 40 custom components and this adds 14.
- **Host data.** Will the CapheViet POS agent put current prices and options in its prompt? The summary elements are useless without them.
- **Should the generator save new elements?** It can still build one-off designs from catalog parts and Markup, but it can't save a reusable component. That needs a create path: a route, or saving a template from the generator's reply, checked by `validateDefinition`. It would also be the only way for the generator to make its own Markup form controls, which only templates allow.
- **Actions still missing:** undo needs a change log genui doesn't have, and the edit actions can't clear a description or a SKU. Neither needs a new element.
