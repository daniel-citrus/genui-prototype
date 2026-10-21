import type { PosMenu } from "../../ports/PosMenu";
import { foldName, sizeLabel } from "../../text/names";
import type { ChoiceSource } from "../types";

/** The dropdown sources of the menu actions; actions using one share the object. */
export interface MenuChoices {
  items: ChoiceSource;
  sizes: ChoiceSource;
  categories: ChoiceSource;
  groups: ChoiceSource;
}

/** Names sorted by their folded form; ties keep their order. */
function byFoldedName(names: string[]): string[] {
  return names
    .map((name) => ({ name, folded: foldName(name) }))
    .sort((a, b) => (a.folded < b.folded ? -1 : a.folded > b.folded ? 1 : 0))
    .map(({ name }) => name);
}

/** The four sources over `menu`, each listing current names sorted by folded name. */
export function createMenuChoices(menu: PosMenu): MenuChoices {
  return {
    items: {
      name: "menu_items",
      list: async () => byFoldedName((await menu.listItems({ includeArchived: true })).map((i) => i.name)),
    },
    sizes: {
      name: "menu_item_sizes",
      list: async () =>
        byFoldedName(
          (await menu.listItems({ includeArchived: true })).flatMap((i) =>
            i.variations.map((v) => sizeLabel(i.name, v.name)),
          ),
        ),
    },
    categories: {
      name: "menu_categories",
      list: async () => byFoldedName((await menu.listCategories()).map((c) => c.name)),
    },
    groups: {
      name: "menu_modifier_groups",
      list: async () => byFoldedName((await menu.listModifierGroups()).map((g) => g.name)),
    },
  };
}
