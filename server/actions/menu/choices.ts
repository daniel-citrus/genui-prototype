import type { PosMenu } from "../../ports/PosMenu";
import { foldName, optionLabel, sizeLabel } from "../../text/names";
import type { ChoiceGroup, ChoiceSource } from "../types";

/** The dropdown sources of the menu actions; actions using one share the object. */
export interface MenuChoices {
  items: ChoiceSource;
  sizes: ChoiceSource;
  categories: ChoiceSource;
  groups: ChoiceSource;
  options: ChoiceSource;
}

/** Names sorted by their folded form; ties keep their order. */
function byFoldedName(names: string[]): string[] {
  return names
    .map((name) => ({ name, folded: foldName(name) }))
    .sort((a, b) => (a.folded < b.folded ? -1 : a.folded > b.folded ? 1 : 0))
    .map(({ name }) => name);
}

/** The last item group: items with no category, or one the menu no longer has. */
export const NO_CATEGORY = "No category";

/** Item names grouped by category name, both sorted by folded name, with `NO_CATEGORY` last. */
async function itemGroups(menu: PosMenu): Promise<ChoiceGroup[]> {
  const [items, categories] = await Promise.all([menu.listItems({ includeArchived: true }), menu.listCategories()]);
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const byCategory = new Map<string, string[]>();
  const uncategorized: string[] = [];
  for (const item of items) {
    const category = item.categoryId === undefined ? undefined : categoryNames.get(item.categoryId);
    if (category === undefined) uncategorized.push(item.name);
    else if (byCategory.has(category)) byCategory.get(category)!.push(item.name);
    else byCategory.set(category, [item.name]);
  }
  const groups = byFoldedName([...byCategory.keys()]).map((name) => ({
    name,
    values: byFoldedName(byCategory.get(name)!),
  }));
  return uncategorized.length > 0 ? [...groups, { name: NO_CATEGORY, values: byFoldedName(uncategorized) }] : groups;
}

/**
 * The five sources over `menu`, each listing current names sorted by folded
 * name. Items are also listed grouped by category.
 */
export function createMenuChoices(menu: PosMenu): MenuChoices {
  return {
    items: {
      name: "menu_items",
      list: async () => byFoldedName((await menu.listItems({ includeArchived: true })).map((i) => i.name)),
      listGroups: () => itemGroups(menu),
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
    options: {
      name: "menu_modifier_options",
      list: async () =>
        byFoldedName(
          (await menu.listModifierGroups()).flatMap((g) => g.options.map((o) => optionLabel(g.name, o.name))),
        ),
    },
  };
}
