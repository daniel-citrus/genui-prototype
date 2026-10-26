/**
 * The café menu, as a point-of-sale system holds it. Mirrors CapheVietPOS at
 * commit 60764e5: `shared/MenuStore.ts` (the methods), `shared/domain/menu.ts`
 * and `shared/domain/money.ts` (the types), so a live CapheVietPOS adapter can
 * implement it without anything above it changing. Its `listLocations` and
 * `getItem` are left out.
 */

/** An integer amount in the currency's minor unit (450 = $4.50), never a float. */
export interface Money {
  amount: number;
  /** ISO 4217 code, e.g. "USD". */
  currency: string;
}

export interface Category {
  id: string;
  name: string;
}

/** A price that applies only at one location, overriding the base price. */
export interface PriceOverride {
  locationId: string;
  price: Money;
}

/** The priced, sellable unit: one size of an item ("M", "L"). */
export interface Variation {
  id: string;
  itemId: string;
  name: string;
  price: Money;
  sku?: string;
  priceOverrides: PriceOverride[];
}

export interface Item {
  id: string;
  name: string;
  description?: string;
  categoryId?: string;
  variations: Variation[];
  modifierGroupIds: string[];
  archived: boolean;
  imageUrl?: string;
}

export interface ModifierOption {
  id: string;
  modifierGroupId: string;
  name: string;
  /** May be zero (e.g. sugar level). */
  priceDelta: Money;
}

/** Reusable across items, e.g. sugar level or toppings. */
export interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  /** 1 = pick one; more = pick up to this many. */
  maxSelect: number;
  options: ModifierOption[];
}

export interface CreateVariationInput {
  name: string;
  price: Money;
  sku?: string;
}

export interface CreateItemInput {
  name: string;
  description?: string;
  categoryId?: string;
  modifierGroupIds?: string[];
  /** At least one is required. */
  variations: CreateVariationInput[];
}

export interface UpdateItemPatch {
  name?: string;
  description?: string;
  /** `null` clears the category. */
  categoryId?: string | null;
  /** Replaces the list. */
  modifierGroupIds?: string[];
}

export interface UpdateVariationPatch {
  name?: string;
  /** `null` clears the SKU. */
  sku?: string | null;
}

export interface ModifierOptionInput {
  name: string;
  /** Extra charge when chosen; may be zero (e.g. sugar level). */
  priceDelta: Money;
}

/** An option in an update: with `id` it changes that option, without it adds one. */
export type ModifierOptionPatch = ModifierOptionInput & { id?: string };

export interface CreateModifierGroupInput {
  name: string;
  /** The customer must pick at least one. */
  required: boolean;
  /** 1 = pick one; more = pick up to this many. */
  maxSelect: number;
  options: ModifierOptionInput[];
}

export interface UpdateModifierGroupPatch {
  name?: string;
  required?: boolean;
  maxSelect?: number;
  /**
   * The full new option list: an entry with an `id` updates that option, one
   * without adds a new option, and an existing option left out is removed.
   */
  options?: ModifierOptionPatch[];
}

/** An expected failure: a refused change (`validation`) or an unknown id (`not_found`). */
export class PosMenuError extends Error {
  readonly code: "validation" | "not_found";

  constructor(message: string, code: "validation" | "not_found") {
    super(message);
    this.name = "PosMenuError";
    this.code = code;
  }
}

/** Every method rejects with a `PosMenuError` on an expected failure. */
export interface PosMenu {
  listCategories(): Promise<Category[]>;
  createCategory(input: { name: string }): Promise<Category>;
  renameCategory(id: string, name: string): Promise<Category>;
  /** Refused while any item, archived or not, is in it. */
  deleteCategory(id: string): Promise<void>;

  listModifierGroups(): Promise<ModifierGroup[]>;
  /**
   * Refused without a name or an option, for an option without a name or with
   * a negative price, two options that differ only in accents, or a `maxSelect`
   * outside 1 to the number of options.
   */
  createModifierGroup(input: CreateModifierGroupInput): Promise<ModifierGroup>;
  /** Checks the group as the patch leaves it, by the same rules as `createModifierGroup`. */
  updateModifierGroup(id: string, patch: UpdateModifierGroupPatch): Promise<ModifierGroup>;
  /** Refused while any item, archived or not, uses it. */
  deleteModifierGroup(id: string): Promise<void>;

  /** Archived items only with `includeArchived: true`. */
  listItems(opts?: { includeArchived?: boolean }): Promise<Item[]>;
  createItem(input: CreateItemInput): Promise<Item>;
  updateItem(id: string, patch: UpdateItemPatch): Promise<Item>;
  setItemArchived(id: string, archived: boolean): Promise<Item>;
  /** Sets the image by URL, or clears it with `null`. */
  setItemImage(itemId: string, imageUrl: string | null): Promise<Item>;

  addVariation(itemId: string, input: CreateVariationInput): Promise<Item>;
  updateVariation(itemId: string, variationId: string, patch: UpdateVariationPatch): Promise<Item>;
  /** Refused for an item's last variation. */
  removeVariation(itemId: string, variationId: string): Promise<Item>;
  setVariationPrice(itemId: string, variationId: string, price: Money): Promise<Item>;
}
