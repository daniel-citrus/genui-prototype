import {
  PosMenuError,
  type Category,
  type Item,
  type ModifierGroup,
  type PosMenu,
  type Variation,
} from "../../ports/PosMenu";
import { cleanName, foldName, sizeLabel } from "../../text/names";

/**
 * Turning submitted values into menu entries. A problem the person can fix
 * throws a `PosMenuError`, which the menu actions answer as `ok: false`.
 */

/** The dropdown inputs, as their messages name them. */
const KINDS = {
  item: { one: "item", many: "items", a: "an item" },
  size: { one: "size", many: "sizes", a: "a size" },
  category: { one: "category", many: "categories", a: "a category" },
  group: { one: "modifier group", many: "modifier groups", a: "a modifier group" },
} as const;

export type MenuInput = keyof typeof KINDS;

/** One size of one item, with its "Item (Size)" label. */
export interface FoundSize {
  item: Item;
  size: Variation;
  label: string;
}

/** A text value, trimmed; "" when missing (or not text). */
export function text(values: Record<string, string | boolean>, key: string): string {
  const value = values[key];
  return typeof value === "string" ? value.trim() : "";
}

/** The value of a required dropdown input, refusing an empty one: "Choose an item first." */
export function chosen(values: Record<string, string | boolean>, input: MenuInput): string {
  const value = text(values, input);
  if (!value) throw new PosMenuError(`Choose ${KINDS[input].a} first.`, "validation");
  return value;
}

/** The one entry labelled `name`: by exact label first, then by a unique match after `foldName`. */
function pick<T>(entries: T[], labelOf: (entry: T) => string, name: string, input: MenuInput): T {
  const kind = KINDS[input];
  const wanted = cleanName(name);
  const folded = foldName(wanted);
  const exact = entries.filter((e) => labelOf(e) === wanted);
  // A name of only punctuation folds to "", which would match every such name.
  const matches = exact.length || !folded ? exact : entries.filter((e) => foldName(labelOf(e)) === folded);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new PosMenuError(`No ${kind.one} named "${wanted}". Ask the agent to show the form again.`, "not_found");
  }
  const labels = matches.map((e) => `"${labelOf(e)}"`).join(", ");
  throw new PosMenuError(
    `"${wanted}" matches ${matches.length} ${kind.many} (${labels}). Rename one so they differ, then try again.`,
    "validation",
  );
}

export async function findItem(menu: PosMenu, name: string): Promise<Item> {
  return pick(await menu.listItems({ includeArchived: true }), (i) => i.name, name, "item");
}

/** `label` is "Item (Size)", matched against every size of every item. */
export async function findSize(menu: PosMenu, label: string): Promise<FoundSize> {
  const sizes = (await menu.listItems({ includeArchived: true })).flatMap((item) =>
    item.variations.map((size) => ({ item, size, label: sizeLabel(item.name, size.name) })),
  );
  return pick(sizes, (s) => s.label, label, "size");
}

export async function findCategory(menu: PosMenu, name: string): Promise<Category> {
  return pick(await menu.listCategories(), (c) => c.name, name, "category");
}

export async function findGroup(menu: PosMenu, name: string): Promise<ModifierGroup> {
  return pick(await menu.listModifierGroups(), (g) => g.name, name, "group");
}
