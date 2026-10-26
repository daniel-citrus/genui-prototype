import {
  PosMenuError,
  type Category,
  type CreateVariationInput,
  type Item,
  type ModifierGroup,
  type Money,
  type PosMenu,
  type UpdateModifierGroupPatch,
  type Variation,
} from "../../ports/PosMenu";
import { cleanName, foldName } from "../../text/names";
import * as fixtures from "./fixtures";

const copy = <T>(value: T): T => structuredClone(value);

const refused = (message: string) => new PosMenuError(message, "validation");
const notFound = (what: string, id: string) => new PosMenuError(`${what} not found: ${id}`, "not_found");

/** A name as stored (trimmed, NFC), refusing an empty one: "Item name is required". */
function requiredName(raw: string, what: "Item" | "Category" | "Variation"): string {
  const name = cleanName(raw);
  if (!name) throw refused(`${what} name is required`);
  return name;
}

/** The entry other than `ignoreId` whose name folds to the same text. Blank names never clash. */
function foldClash<T extends { id: string; name: string }>(list: T[], name: string, ignoreId?: string): T | undefined {
  const folded = foldName(name);
  return folded ? list.find((x) => x.id !== ignoreId && foldName(x.name) === folded) : undefined;
}

/** Refuse a size name that folds to the same text as another size of the item. */
function assertSizeFree(sizes: Variation[], name: string, ignoreId?: string): void {
  const clash = foldClash(sizes, name, ignoreId);
  if (clash) throw refused(`"${name}" and "${clash.name}" are the same size ignoring accents.`);
}

function checkedPrice(price: Money): Money {
  if (!Number.isInteger(price.amount) || price.amount < 0) {
    throw refused("Price must be a non-negative integer amount");
  }
  return { amount: price.amount, currency: price.currency };
}

/**
 * Refuse to delete a category or modifier group that any item (archived ones
 * included) still uses, so a delete never quietly changes items.
 */
function assertUnused(users: Item[], what: "category" | "modifier group", fix: string): void {
  if (users.length === 0) return;
  const names = users.slice(0, 3).map((i) => i.name).join(", ");
  const more = users.length > 3 ? `, and ${users.length - 3} more` : "";
  throw refused(
    `${users.length} ${users.length === 1 ? "item uses" : "items use"} this ${what} (${names}${more}). ${fix} first.`,
  );
}

/**
 * A `PosMenu` over a private copy of the demo café menu (`./fixtures`), with
 * CapheVietPOS's menu rules (its `InMemoryMenuAdapter` and
 * `server/menu/rules.ts` at commit 60764e5). Changes last only as long as the
 * instance; every returned object is a copy.
 */
export function createInMemoryPosMenu(): PosMenu {
  let categories = copy(fixtures.categories);
  let modifierGroups = copy(fixtures.modifierGroups);
  const items = copy(fixtures.items);
  let lastId = 0;
  const nextId = (prefix: string) => `${prefix}-${++lastId}`;

  function getCategory(id: string): Category {
    const category = categories.find((c) => c.id === id);
    if (!category) throw notFound("Category", id);
    return category;
  }

  /** Stricter than CapheVietPOS, which only refuses the same spelling. */
  function assertCategoryNameFree(name: string, ignoreId?: string): void {
    const clash = foldClash(categories, name, ignoreId);
    if (clash) throw refused(`A category named "${clash.name}" already exists.`);
  }

  function assertGroupsExist(ids: string[]): void {
    const missing = ids.find((id) => !modifierGroups.some((g) => g.id === id));
    if (missing !== undefined) throw notFound("Modifier group", missing);
  }

  /** Stricter than CapheVietPOS, which only refuses the same spelling. */
  function assertGroupNameFree(name: string, ignoreId?: string): void {
    const clash = foldClash(modifierGroups, name, ignoreId);
    if (clash) throw refused(`A modifier group named "${clash.name}" already exists.`);
  }

  /**
   * The group `current` becomes under `patch` (a new group with id `id` when
   * there is no `current`), checked like CapheVietPOS's `modifierGroupDraft`.
   */
  function buildModifierGroup(
    id: string,
    current: ModifierGroup | undefined,
    patch: UpdateModifierGroupPatch,
  ): ModifierGroup {
    const name = cleanName(patch.name ?? current?.name ?? "");
    if (!name) throw refused("Modifier group name is required");
    const options = (patch.options ?? current?.options ?? []).map((o) => ({ ...o, name: cleanName(o.name) }));
    if (!options.length) throw refused("A modifier group needs at least one option");
    for (const [i, o] of options.entries()) {
      if (!o.name) throw refused("Every option needs a name");
      if (!Number.isInteger(o.priceDelta.amount) || o.priceDelta.amount < 0) {
        throw refused(`"${o.name}" needs a price of $0.00 or more`);
      }
      if (current && o.id !== undefined && !current.options.some((existing) => existing.id === o.id)) {
        throw refused(`Option ${o.id} isn't in "${current.name}"`);
      }
      const folded = foldName(o.name);
      const clash = folded && options.slice(0, i).find((earlier) => foldName(earlier.name) === folded);
      if (clash) throw refused(`"${o.name}" and "${clash.name}" are the same option ignoring accents.`);
    }
    const maxSelect = patch.maxSelect ?? current?.maxSelect ?? 1;
    if (!Number.isInteger(maxSelect) || maxSelect < 1 || maxSelect > options.length) {
      throw refused(`Customers can pick between 1 and ${options.length} options here`);
    }
    const required = patch.required ?? current?.required ?? false;
    return {
      id,
      name,
      required,
      minSelect: required ? 1 : 0,
      maxSelect,
      options: options.map((o) => ({
        id: (current && o.id) || nextId("MO"),
        modifierGroupId: id,
        name: o.name,
        priceDelta: { amount: o.priceDelta.amount, currency: o.priceDelta.currency },
      })),
    };
  }

  function getItem(id: string): Item {
    const item = items.find((i) => i.id === id);
    if (!item) throw notFound("Item", id);
    return item;
  }

  function getVariation(item: Item, id: string): Variation {
    const variation = item.variations.find((v) => v.id === id);
    if (!variation) throw notFound("Variation", id);
    return variation;
  }

  function buildVariation(itemId: string, input: CreateVariationInput): Variation {
    const name = requiredName(input.name, "Variation");
    const price = checkedPrice(input.price);
    const sku = input.sku?.trim();
    return { id: nextId("VAR"), itemId, name, price, ...(sku ? { sku } : {}), priceOverrides: [] };
  }

  return {
    async listCategories() {
      return copy(categories);
    },

    async createCategory(input) {
      const name = requiredName(input.name, "Category");
      assertCategoryNameFree(name);
      const category = { id: nextId("CAT"), name };
      categories.push(category);
      return copy(category);
    },

    async renameCategory(id, rawName) {
      const category = getCategory(id);
      const name = requiredName(rawName, "Category");
      assertCategoryNameFree(name, id);
      category.name = name;
      return copy(category);
    },

    async deleteCategory(id) {
      getCategory(id);
      assertUnused(
        items.filter((i) => i.categoryId === id),
        "category",
        "Move them to another category",
      );
      categories = categories.filter((c) => c.id !== id);
    },

    async listModifierGroups() {
      return copy(modifierGroups);
    },

    async createModifierGroup(input) {
      const group = buildModifierGroup(nextId("MG"), undefined, input);
      assertGroupNameFree(group.name);
      modifierGroups.push(group);
      return copy(group);
    },

    async updateModifierGroup(id, patch) {
      const index = modifierGroups.findIndex((g) => g.id === id);
      if (index === -1) throw notFound("Modifier group", id);
      const group = buildModifierGroup(id, modifierGroups[index], patch);
      assertGroupNameFree(group.name, id);
      modifierGroups[index] = group;
      return copy(group);
    },

    async deleteModifierGroup(id) {
      assertGroupsExist([id]);
      assertUnused(
        items.filter((i) => i.modifierGroupIds.includes(id)),
        "modifier group",
        "Detach it from them",
      );
      modifierGroups = modifierGroups.filter((g) => g.id !== id);
    },

    async listItems(opts) {
      return copy(opts?.includeArchived ? items : items.filter((i) => !i.archived));
    },

    async createItem(input) {
      const name = requiredName(input.name, "Item");
      if (!input.variations.length) throw refused("An item needs at least one variation");
      if (input.categoryId !== undefined) getCategory(input.categoryId);
      assertGroupsExist(input.modifierGroupIds ?? []);

      const id = nextId("ITEM");
      const variations: Variation[] = [];
      for (const v of input.variations) {
        const variation = buildVariation(id, v);
        assertSizeFree(variations, variation.name);
        variations.push(variation);
      }
      const description = input.description?.trim();
      const item: Item = {
        id,
        name,
        ...(description ? { description } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        variations,
        modifierGroupIds: [...(input.modifierGroupIds ?? [])],
        archived: false,
      };
      items.push(item);
      return copy(item);
    },

    async updateItem(id, patch) {
      const item = getItem(id);
      // Check the whole patch first, so a refused one changes nothing.
      const name = patch.name === undefined ? undefined : requiredName(patch.name, "Item");
      if (patch.categoryId != null) getCategory(patch.categoryId);
      if (patch.modifierGroupIds) assertGroupsExist(patch.modifierGroupIds);

      if (name !== undefined) item.name = name;
      if (patch.description !== undefined) {
        const description = patch.description.trim();
        if (description) item.description = description;
        else delete item.description;
      }
      if (patch.categoryId === null) delete item.categoryId;
      else if (patch.categoryId !== undefined) item.categoryId = patch.categoryId;
      if (patch.modifierGroupIds) item.modifierGroupIds = [...patch.modifierGroupIds];
      return copy(item);
    },

    async setItemArchived(id, archived) {
      const item = getItem(id);
      item.archived = archived;
      return copy(item);
    },

    async setItemImage(itemId, imageUrl) {
      const item = getItem(itemId);
      if (imageUrl === null) {
        delete item.imageUrl;
        return copy(item);
      }
      const url = imageUrl.trim();
      const protocol = URL.parse(url)?.protocol;
      if (protocol !== "http:" && protocol !== "https:") {
        throw refused("Image must be an http or https URL");
      }
      item.imageUrl = url;
      return copy(item);
    },

    async addVariation(itemId, input) {
      const item = getItem(itemId);
      const variation = buildVariation(itemId, input);
      assertSizeFree(item.variations, variation.name);
      item.variations.push(variation);
      return copy(item);
    },

    async updateVariation(itemId, variationId, patch) {
      const item = getItem(itemId);
      const variation = getVariation(item, variationId);
      if (patch.name !== undefined) {
        const name = requiredName(patch.name, "Variation");
        assertSizeFree(item.variations, name, variationId);
        variation.name = name;
      }
      if (patch.sku !== undefined) {
        const sku = patch.sku?.trim();
        if (sku) variation.sku = sku;
        else delete variation.sku;
      }
      return copy(item);
    },

    async removeVariation(itemId, variationId) {
      const item = getItem(itemId);
      getVariation(item, variationId);
      if (item.variations.length === 1) throw refused("An item must keep at least one variation");
      item.variations = item.variations.filter((v) => v.id !== variationId);
      return copy(item);
    },

    async setVariationPrice(itemId, variationId, price) {
      const item = getItem(itemId);
      getVariation(item, variationId).price = checkedPrice(price);
      return copy(item);
    },
  };
}
