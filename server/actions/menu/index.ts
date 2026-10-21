import { MAX_FIELD_CHARS } from "shared/api";
import {
  PosMenuError,
  type Money,
  type PosMenu,
  type UpdateItemPatch,
  type UpdateVariationPatch,
} from "../../ports/PosMenu";
import { sizeLabel } from "../../text/names";
import type { ActionDefinition } from "../types";
import { createMenuChoices } from "./choices";
import { formatPrice, parsePrice } from "./money";
import { chosen, findCategory, findGroup, findItem, findSize, text } from "./resolve";

type Values = Record<string, string | boolean>;

/** Longest name an input takes for an item, size, category or modifier group. */
const MAX_NAME_CHARS = 100;

const NOTHING_TO_CHANGE = "Nothing to change: fill in at least one field.";

const refused = (message: string) => new PosMenuError(message, "validation");

const nameInput = (description: string) => ({ type: "string", maxLength: MAX_NAME_CHARS, description });
const textInput = (description: string) => ({ type: "string", maxLength: MAX_FIELD_CHARS, description });

const ITEM = nameInput("The item's name, one of the menu_items choices.");
const SIZE = textInput('The size as "Item (Size)", one of the menu_item_sizes choices.');
const CATEGORY = nameInput("The category's name, one of the menu_categories choices.");
const GROUP = nameInput("The modifier group's name, one of the menu_modifier_groups choices.");
const PRICE = textInput("Price in dollars, e.g. 4.50.");

function inputs(properties: Record<string, object>, required: string[]): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

/**
 * A handler from `body`, which returns its success message. A `PosMenuError`
 * (from the menu or from resolving a value) becomes `ok: false` with its
 * message; anything else is rethrown, for the registry to log.
 */
function guarded(body: (values: Values) => Promise<string>): ActionDefinition["run"] {
  return async (values) => {
    try {
      return { ok: true, message: await body(values) };
    } catch (err) {
      if (err instanceof PosMenuError) return { ok: false, message: err.message };
      throw err;
    }
  };
}

function price(values: Values): Money {
  const money = parsePrice(text(values, "price"));
  if (!money) throw refused("Price must look like 4.50.");
  return money;
}

/** `"Old"`, or `"Old" (now "New")` when renamed. */
function renamed(before: string, after: string): string {
  return after === before ? `"${before}"` : `"${before}" (now "${after}")`;
}

/**
 * The actions that change the café menu in `menu`. Their dropdown inputs
 * (`item`, `size`, `category`, `group`) take names from the shared sources and
 * are resolved by name when the action runs; an empty optional input leaves
 * that field as it is.
 */
export function createMenuActions(menu: PosMenu): ActionDefinition[] {
  const choices = createMenuChoices(menu);

  async function itemAndGroup(values: Values) {
    const itemName = chosen(values, "item");
    const groupName = chosen(values, "group");
    return { item: await findItem(menu, itemName), group: await findGroup(menu, groupName) };
  }

  return [
    {
      name: "menu_create_item",
      description:
        "Adds an item with one size to the menu. Reads name, size (the size's name, e.g. M), price, and optionally description and category.",
      area: "items",
      operation: "create",
      input_schema: inputs(
        {
          name: nameInput("The new item's name."),
          size: nameInput("Name of its one size, e.g. M or Regular."),
          price: PRICE,
          description: textInput("What the item is. Optional."),
          category: nameInput("The category to put it in, one of the menu_categories choices. Optional."),
        },
        ["name", "size", "price"],
      ),
      choices: { category: choices.categories },
      run: guarded(async (values) => {
        const money = price(values);
        const categoryName = text(values, "category");
        const category = categoryName ? await findCategory(menu, categoryName) : undefined;
        const description = text(values, "description");
        const size = text(values, "size");
        const item = await menu.createItem({
          name: text(values, "name"),
          ...(description ? { description } : {}),
          ...(category ? { categoryId: category.id } : {}),
          variations: [{ name: size, price: money }],
        });
        const where = category ? ` in "${category.name}"` : "";
        return `Created "${item.name}"${where} with the size ${size} at ${formatPrice(money)}.`;
      }),
    },
    {
      name: "menu_update_item",
      description:
        "Changes an item's name, description or category; an empty field stays as it is. Reads item, name, description and category.",
      area: "items",
      operation: "edit",
      input_schema: inputs(
        {
          item: ITEM,
          name: nameInput("New name. Empty keeps the current one."),
          description: textInput("New description. Empty keeps the current one."),
          category: nameInput(
            "Category to move it to, one of the menu_categories choices. Empty keeps the current one.",
          ),
        },
        ["item"],
      ),
      choices: { item: choices.items, category: choices.categories },
      run: guarded(async (values) => {
        const itemName = chosen(values, "item");
        const changed = (["name", "description", "category"] as const).filter((key) => text(values, key));
        if (!changed.length) throw refused(NOTHING_TO_CHANGE);
        const item = await findItem(menu, itemName);
        const patch: UpdateItemPatch = {};
        if (changed.includes("name")) patch.name = text(values, "name");
        if (changed.includes("description")) patch.description = text(values, "description");
        if (changed.includes("category")) patch.categoryId = (await findCategory(menu, text(values, "category"))).id;
        const updated = await menu.updateItem(item.id, patch);
        return `Updated ${renamed(item.name, updated.name)}: ${changed.join(", ")}.`;
      }),
    },
    {
      name: "menu_set_item_archived",
      description:
        "Archives an item, hiding it from the menu, or brings an archived one back. Reads item and archived.",
      area: "items",
      operation: "archive",
      input_schema: inputs(
        { item: ITEM, archived: { type: "boolean", description: "true archives the item; false brings it back." } },
        ["item", "archived"],
      ),
      choices: { item: choices.items },
      run: guarded(async (values) => {
        const item = await findItem(menu, chosen(values, "item"));
        const archived = values.archived === true;
        await menu.setItemArchived(item.id, archived);
        return archived
          ? `Archived "${item.name}": it no longer shows on the menu.`
          : `Unarchived "${item.name}": it shows on the menu again.`;
      }),
    },
    {
      name: "menu_set_item_image",
      description:
        "Sets an item's image from a web address, or clears it when image_url is empty. Reads item and image_url.",
      area: "items",
      operation: "edit",
      input_schema: inputs(
        { item: ITEM, image_url: textInput("An http or https image address. Empty clears the image.") },
        ["item"],
      ),
      choices: { item: choices.items },
      run: guarded(async (values) => {
        const item = await findItem(menu, chosen(values, "item"));
        const url = text(values, "image_url");
        await menu.setItemImage(item.id, url || null);
        return url ? `Set the image of "${item.name}".` : `Cleared the image of "${item.name}".`;
      }),
    },
    {
      name: "menu_attach_modifier_group",
      description: "Offers a modifier group (e.g. sugar level) on an item. Reads item and group.",
      area: "modifier_groups",
      operation: "attach",
      input_schema: inputs({ item: ITEM, group: GROUP }, ["item", "group"]),
      choices: { item: choices.items, group: choices.groups },
      run: guarded(async (values) => {
        const { item, group } = await itemAndGroup(values);
        if (item.modifierGroupIds.includes(group.id)) {
          return `"${item.name}" already offers "${group.name}"; nothing changed.`;
        }
        await menu.updateItem(item.id, { modifierGroupIds: [...item.modifierGroupIds, group.id] });
        return `"${item.name}" now offers "${group.name}".`;
      }),
    },
    {
      name: "menu_detach_modifier_group",
      description: "Stops offering a modifier group on an item. Reads item and group.",
      area: "modifier_groups",
      operation: "detach",
      input_schema: inputs({ item: ITEM, group: GROUP }, ["item", "group"]),
      choices: { item: choices.items, group: choices.groups },
      run: guarded(async (values) => {
        const { item, group } = await itemAndGroup(values);
        if (!item.modifierGroupIds.includes(group.id)) {
          return `"${item.name}" doesn't offer "${group.name}"; nothing changed.`;
        }
        await menu.updateItem(item.id, { modifierGroupIds: item.modifierGroupIds.filter((id) => id !== group.id) });
        return `"${item.name}" no longer offers "${group.name}".`;
      }),
    },
    {
      name: "menu_add_size",
      description: "Adds a size with its price to an item. Reads item, name (the new size's name) and price.",
      area: "sizes",
      operation: "create",
      input_schema: inputs(
        { item: ITEM, name: nameInput("The new size's name, e.g. L."), price: PRICE },
        ["item", "name", "price"],
      ),
      choices: { item: choices.items },
      run: guarded(async (values) => {
        const itemName = chosen(values, "item");
        const money = price(values);
        const item = await findItem(menu, itemName);
        const name = text(values, "name");
        await menu.addVariation(item.id, { name, price: money });
        return `Added the size "${sizeLabel(item.name, name)}" at ${formatPrice(money)}.`;
      }),
    },
    {
      name: "menu_update_size",
      description: "Renames a size or changes its SKU; an empty field stays as it is. Reads size, name and sku.",
      area: "sizes",
      operation: "edit",
      input_schema: inputs(
        {
          size: SIZE,
          name: nameInput("New size name, e.g. L. Empty keeps the current one."),
          sku: textInput("New SKU (stock code). Empty keeps the current one."),
        },
        ["size"],
      ),
      choices: { size: choices.sizes },
      run: guarded(async (values) => {
        const label = chosen(values, "size");
        const changed = (["name", "sku"] as const).filter((key) => text(values, key));
        if (!changed.length) throw refused(NOTHING_TO_CHANGE);
        const found = await findSize(menu, label);
        const patch: UpdateVariationPatch = {};
        if (changed.includes("name")) patch.name = text(values, "name");
        if (changed.includes("sku")) patch.sku = text(values, "sku");
        await menu.updateVariation(found.item.id, found.size.id, patch);
        const after = patch.name ? sizeLabel(found.item.name, patch.name) : found.label;
        return `Updated ${renamed(found.label, after)}: ${changed.join(", ")}.`;
      }),
    },
    {
      name: "menu_set_size_price",
      description: "Sets the price of one size of an item. Reads size and price.",
      area: "prices",
      operation: "edit",
      input_schema: inputs({ size: SIZE, price: PRICE }, ["size", "price"]),
      choices: { size: choices.sizes },
      run: guarded(async (values) => {
        const label = chosen(values, "size");
        const money = price(values);
        const found = await findSize(menu, label);
        await menu.setVariationPrice(found.item.id, found.size.id, money);
        return `Set "${found.label}" to ${formatPrice(money)} (was ${formatPrice(found.size.price)}).`;
      }),
    },
    {
      name: "menu_remove_size",
      description: "Removes one size from an item for good; an item keeps at least one size. Reads size.",
      area: "sizes",
      operation: "delete",
      input_schema: inputs({ size: SIZE }, ["size"]),
      choices: { size: choices.sizes },
      confirm: "Remove the size {size}? This can't be undone.",
      run: guarded(async (values) => {
        const found = await findSize(menu, chosen(values, "size"));
        await menu.removeVariation(found.item.id, found.size.id);
        return `Removed the size "${found.label}".`;
      }),
    },
    {
      name: "menu_create_category",
      description: "Adds a category to the menu. Reads name.",
      area: "categories",
      operation: "create",
      input_schema: inputs({ name: nameInput("The new category's name.") }, ["name"]),
      run: guarded(async (values) => {
        const category = await menu.createCategory({ name: text(values, "name") });
        return `Created the category "${category.name}".`;
      }),
    },
    {
      name: "menu_rename_category",
      description: "Renames a category. Reads category and name (the new name).",
      area: "categories",
      operation: "edit",
      input_schema: inputs({ category: CATEGORY, name: nameInput("The category's new name.") }, ["category", "name"]),
      choices: { category: choices.categories },
      run: guarded(async (values) => {
        const category = await findCategory(menu, chosen(values, "category"));
        const updated = await menu.renameCategory(category.id, text(values, "name"));
        return `Renamed the category "${category.name}" to "${updated.name}".`;
      }),
    },
    {
      name: "menu_delete_category",
      description: "Deletes a category no item uses, for good. Reads category.",
      area: "categories",
      operation: "delete",
      input_schema: inputs({ category: CATEGORY }, ["category"]),
      choices: { category: choices.categories },
      confirm: "Delete the category {category}? This can't be undone.",
      run: guarded(async (values) => {
        const category = await findCategory(menu, chosen(values, "category"));
        await menu.deleteCategory(category.id);
        return `Deleted the category "${category.name}".`;
      }),
    },
    {
      name: "menu_delete_modifier_group",
      description: "Deletes a modifier group no item uses, for good. Reads group.",
      area: "modifier_groups",
      operation: "delete",
      input_schema: inputs({ group: GROUP }, ["group"]),
      choices: { group: choices.groups },
      confirm: "Delete the modifier group {group}? This can't be undone.",
      run: guarded(async (values) => {
        const group = await findGroup(menu, chosen(values, "group"));
        await menu.deleteModifierGroup(group.id);
        return `Deleted the modifier group "${group.name}".`;
      }),
    },
  ];
}
