import { MAX_FIELD_CHARS } from "shared/api";
import {
  PosMenuError,
  type ModifierGroup,
  type ModifierOptionInput,
  type ModifierOptionPatch,
  type Money,
  type PosMenu,
  type UpdateItemPatch,
  type UpdateModifierGroupPatch,
  type UpdateVariationPatch,
} from "../../ports/PosMenu";
import { optionLabel, sizeLabel } from "../../text/names";
import type { ActionDefinition } from "../types";
import { createMenuChoices } from "./choices";
import { formatPrice, parsePrice } from "./money";
import { chosen, findCategory, findGroup, findItem, findOption, findSize, text } from "./resolve";

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
const OPTION = textInput('The option as "Group: Option", one of the menu_modifier_options choices.');
const PRICE = textInput("Price in dollars, e.g. 4.50.");

const FREE: Money = { amount: 0, currency: "USD" };

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

/** An option's extra charge, typed in dollars; empty is free. */
function charge(raw: string): Money {
  if (!raw) return FREE;
  const money = parsePrice(raw);
  if (!money) throw refused("Extra charge must look like 0.75.");
  return money;
}

/** How many options a customer may pick, typed as a whole number. */
function maxSelect(raw: string): number {
  if (!/^\d+$/.test(raw)) throw refused("How many a customer may pick must be a whole number, e.g. 1.");
  return Number(raw);
}

/**
 * Options typed as "Trân châu +0.75, Thạch, Kem cheese +$1.25": separated by
 * commas, each with an optional extra charge after its last plus sign.
 */
function parseOptions(raw: string): ModifierOptionInput[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const plus = entry.lastIndexOf("+");
      if (plus === -1) return { name: entry, priceDelta: FREE };
      const money = parsePrice(entry.slice(plus + 1));
      if (!money) throw refused(`"${entry}": write its extra charge like +0.75.`);
      return { name: entry.slice(0, plus).trim(), priceDelta: money };
    });
}

/** A group's current options, as the full list `updateModifierGroup` takes. */
function optionPatches(group: ModifierGroup): ModifierOptionPatch[] {
  return group.options.map(({ id, name, priceDelta }) => ({ id, name, priceDelta }));
}

/** "at +$0.75", or "at no extra charge". */
function chargeText(money: Money): string {
  return money.amount > 0 ? `at +${formatPrice(money)}` : "at no extra charge";
}

/** `"Topping" (pick up to 3): Trân châu +$0.75, Thạch`, as CapheVietPOS's `describeModifierGroup` writes it. */
function describeGroup(group: ModifierGroup): string {
  const rule = group.maxSelect === 1 ? "pick one" : `pick up to ${group.maxSelect}`;
  const options = group.options
    .map((o) => (o.priceDelta.amount > 0 ? `${o.name} +${formatPrice(o.priceDelta)}` : o.name))
    .join(", ");
  return `"${group.name}" (${rule}${group.required ? ", required" : ""}): ${options}`;
}

/** `"Old"`, or `"Old" (now "New")` when renamed. */
function renamed(before: string, after: string): string {
  return after === before ? `"${before}"` : `"${before}" (now "${after}")`;
}

/**
 * The actions that change the café menu in `menu`. Their dropdown inputs
 * (`item`, `size`, `category`, `group`, `option`) take names from the shared sources and
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
    {
      name: "menu_create_modifier_group",
      description:
        "Adds a modifier group (e.g. sugar level) with its options. Reads name, options, and optionally required and max_select.",
      area: "modifier_groups",
      operation: "create",
      input_schema: inputs(
        {
          name: nameInput("The new group's name, e.g. Sugar level."),
          options: textInput(
            'Its options, separated by commas, each with an optional extra charge after a plus sign, e.g. "Trân châu +0.75, Thạch +0.75, Kem cheese +1.25".',
          ),
          required: {
            type: "boolean",
            description: "true means the customer must pick at least one; missing or false means optional.",
          },
          max_select: textInput("How many options a customer may pick, a whole number; 1 means pick one. Empty means 1."),
        },
        ["name", "options"],
      ),
      run: guarded(async (values) => {
        const max = text(values, "max_select");
        const group = await menu.createModifierGroup({
          name: text(values, "name"),
          required: values.required === true,
          maxSelect: max ? maxSelect(max) : 1,
          options: parseOptions(text(values, "options")),
        });
        return `Created the modifier group ${describeGroup(group)}.`;
      }),
    },
    {
      name: "menu_update_modifier_group",
      description:
        "Renames a modifier group or changes how many options a customer may pick; an empty field stays as it is. Reads group, name and max_select.",
      area: "modifier_groups",
      operation: "edit",
      input_schema: inputs(
        {
          group: GROUP,
          name: nameInput("New name. Empty keeps the current one."),
          max_select: textInput(
            "How many options a customer may pick, a whole number; 1 means pick one. Empty keeps the current one.",
          ),
        },
        ["group"],
      ),
      choices: { group: choices.groups },
      run: guarded(async (values) => {
        const groupName = chosen(values, "group");
        const changed = (["name", "max_select"] as const).filter((key) => text(values, key));
        if (!changed.length) throw refused(NOTHING_TO_CHANGE);
        const patch: UpdateModifierGroupPatch = {};
        if (changed.includes("max_select")) patch.maxSelect = maxSelect(text(values, "max_select"));
        if (changed.includes("name")) patch.name = text(values, "name");
        const group = await findGroup(menu, groupName);
        const updated = await menu.updateModifierGroup(group.id, patch);
        const fields = changed.map((key) => (key === "max_select" ? "pick limit" : key));
        return `Updated ${renamed(group.name, updated.name)}: ${fields.join(", ")}.`;
      }),
    },
    {
      name: "menu_set_modifier_group_required",
      description:
        "Makes a modifier group required (the customer must pick at least one) or optional. Reads group and required.",
      area: "modifier_groups",
      operation: "edit",
      input_schema: inputs(
        {
          group: GROUP,
          required: { type: "boolean", description: "true makes the group required; false makes it optional." },
        },
        ["group", "required"],
      ),
      choices: { group: choices.groups },
      run: guarded(async (values) => {
        const group = await findGroup(menu, chosen(values, "group"));
        const required = values.required === true;
        await menu.updateModifierGroup(group.id, { required });
        return required
          ? `"${group.name}" is now required: customers must pick at least one.`
          : `"${group.name}" is now optional.`;
      }),
    },
    {
      name: "menu_add_modifier_option",
      description: "Adds an option to a modifier group. Reads group, name and optionally price (the extra charge).",
      area: "modifier_options",
      operation: "create",
      input_schema: inputs(
        {
          group: GROUP,
          name: nameInput("The new option's name, e.g. Trân châu."),
          price: textInput("Extra charge in dollars, e.g. 0.75. Empty means no extra charge."),
        },
        ["group", "name"],
      ),
      choices: { group: choices.groups },
      run: guarded(async (values) => {
        const groupName = chosen(values, "group");
        const priceDelta = charge(text(values, "price"));
        const group = await findGroup(menu, groupName);
        const name = text(values, "name");
        await menu.updateModifierGroup(group.id, { options: [...optionPatches(group), { name, priceDelta }] });
        return `Added the option "${optionLabel(group.name, name)}" ${chargeText(priceDelta)}.`;
      }),
    },
    {
      name: "menu_update_modifier_option",
      description:
        "Renames an option of a modifier group or changes its extra charge; an empty field stays as it is. Reads option, name and price.",
      area: "modifier_options",
      operation: "edit",
      input_schema: inputs(
        {
          option: OPTION,
          name: nameInput("New option name. Empty keeps the current one."),
          price: textInput("New extra charge in dollars, e.g. 0.75; 0 makes it free. Empty keeps the current one."),
        },
        ["option"],
      ),
      choices: { option: choices.options },
      run: guarded(async (values) => {
        const label = chosen(values, "option");
        const changed = (["name", "price"] as const).filter((key) => text(values, key));
        if (!changed.length) throw refused(NOTHING_TO_CHANGE);
        const priceDelta = changed.includes("price") ? charge(text(values, "price")) : undefined;
        const { group, option, label: before } = await findOption(menu, label);
        const name = text(values, "name") || option.name;
        await menu.updateModifierGroup(group.id, {
          options: optionPatches(group).map((o) =>
            o.id === option.id ? { ...o, name, priceDelta: priceDelta ?? o.priceDelta } : o,
          ),
        });
        return `Updated ${renamed(before, optionLabel(group.name, name))}: ${changed.join(", ")}.`;
      }),
    },
    {
      name: "menu_remove_modifier_option",
      description: "Removes one option from a modifier group for good; a group keeps at least one option. Reads option.",
      area: "modifier_options",
      operation: "delete",
      input_schema: inputs({ option: OPTION }, ["option"]),
      choices: { option: choices.options },
      confirm: "Remove the option {option}? This can't be undone.",
      run: guarded(async (values) => {
        const { group, option, label } = await findOption(menu, chosen(values, "option"));
        const rest = optionPatches(group).filter((o) => o.id !== option.id);
        if (rest.length && group.maxSelect > rest.length) {
          throw refused(
            `"${group.name}" lets customers pick up to ${group.maxSelect}; lower that to ${rest.length} first.`,
          );
        }
        await menu.updateModifierGroup(group.id, { options: rest });
        return `Removed the option "${label}".`;
      }),
    },
  ];
}
