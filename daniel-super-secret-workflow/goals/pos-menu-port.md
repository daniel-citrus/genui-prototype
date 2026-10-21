---
id: pos-menu-port
priority: 20
depends: []
touches:
  - server/ports/PosMenu.ts
  - server/text/names.ts
  - server/text/names.test.ts
  - server/adapters/pos/fixtures.ts
  - server/adapters/pos/InMemoryPosMenu.ts
  - server/adapters/pos/InMemoryPosMenu.test.ts
scope: medium
---

# Add the PosMenu port and an in-memory demo café menu

## Sources

- [POS menu actions plan — R1: PosMenu port](../plans/pos-menu-actions.md#r1-posmenu-port-mirrors-caphevietposs-menustore)
- [POS menu actions plan — R2: In-memory demo menu](../plans/pos-menu-actions.md#r2-in-memory-demo-menu)
- [POS menu actions plan — Interfaces](../plans/pos-menu-actions.md#interfaces)
- CapheVietPOS at commit 60764e5 in `~/Documents/repo/CapheVietPOS`: `shared/MenuStore.ts`, `shared/domain/menu.ts`, `shared/domain/money.ts`, `shared/domain/names.ts`, `server/menu/rules.ts`, `server/menu/memory/InMemoryMenuAdapter.ts`, `server/menu/memory/fixtures.ts` (local only)

## Context

The app (Fastify API in `server/`, browser sandbox in `src/`, shared wire types
in `shared/`) will let generated forms edit a café menu through server-side
actions. Later goals build fourteen menu actions on top of a menu port. This
goal adds only that port, the name helpers, and an in-memory adapter seeded with
the CapheVietPOS placeholder café menu. Nothing else in the app uses them yet.

The port mirrors CapheVietPOS's `MenuStore` so a live CapheVietPOS adapter can
implement it later without anything above it changing. Existing ports live in
`server/ports/` (see `ComponentRepository.ts`); adapters live under
`server/adapters/`. Server code imports shared code as `shared/...`
(`tsconfig.server.json` paths). Tests use `node:test` and `node:assert/strict`,
are named `*.test.ts`, and are picked up by `npm test` automatically.

## Scope

### `server/ports/PosMenu.ts` (new)

Declare exactly these types, with these field names and optionality, and a doc
comment naming CapheVietPOS `shared/MenuStore.ts`, `shared/domain/menu.ts` and
`shared/domain/money.ts` at commit 60764e5 as what it mirrors:

```ts
export interface Money { amount: number; currency: string } // minor units (450 = $4.50)
export interface Category { id: string; name: string }
export interface PriceOverride { locationId: string; price: Money }
export interface Variation { id: string; itemId: string; name: string; price: Money; sku?: string; priceOverrides: PriceOverride[] }
export interface Item { id: string; name: string; description?: string; categoryId?: string; variations: Variation[]; modifierGroupIds: string[]; archived: boolean; imageUrl?: string }
export interface ModifierOption { id: string; modifierGroupId: string; name: string; priceDelta: Money }
export interface ModifierGroup { id: string; name: string; required: boolean; minSelect: number; maxSelect: number; options: ModifierOption[] }
export interface CreateVariationInput { name: string; price: Money; sku?: string }
export interface CreateItemInput { name: string; description?: string; categoryId?: string; modifierGroupIds?: string[]; variations: CreateVariationInput[] }
export interface UpdateItemPatch { name?: string; description?: string; categoryId?: string | null; modifierGroupIds?: string[] }
export interface UpdateVariationPatch { name?: string; sku?: string | null }

export class PosMenuError extends Error {
  constructor(message: string, readonly code: "validation" | "not_found") { super(message); }
}

export interface PosMenu {
  listCategories(): Promise<Category[]>;
  createCategory(input: { name: string }): Promise<Category>;
  renameCategory(id: string, name: string): Promise<Category>;
  deleteCategory(id: string): Promise<void>;
  listModifierGroups(): Promise<ModifierGroup[]>;
  deleteModifierGroup(id: string): Promise<void>;
  listItems(opts?: { includeArchived?: boolean }): Promise<Item[]>;
  createItem(input: CreateItemInput): Promise<Item>;
  updateItem(id: string, patch: UpdateItemPatch): Promise<Item>;
  setItemArchived(id: string, archived: boolean): Promise<Item>;
  setItemImage(itemId: string, imageUrl: string | null): Promise<Item>;
  addVariation(itemId: string, input: CreateVariationInput): Promise<Item>;
  updateVariation(itemId: string, variationId: string, patch: UpdateVariationPatch): Promise<Item>;
  removeVariation(itemId: string, variationId: string): Promise<Item>;
  setVariationPrice(itemId: string, variationId: string, price: Money): Promise<Item>;
}
```

`tsconfig.server.json` sets `erasableSyntaxOnly`, so a constructor parameter
property (`readonly code` in the constructor) does not compile: declare `code`
as a field and assign it in the constructor instead. Set `name` to
`"PosMenuError"`. CapheVietPOS's `listLocations`, `getItem`,
`createModifierGroup` and `updateModifierGroup` are deliberately left out.

### `server/text/names.ts` (new)

Copy these from CapheVietPOS `shared/domain/names.ts` unchanged. It sits outside
`server/adapters` so actions can use it without depending on one adapter.

```ts
/** The stored form of a name: trimmed, in one Unicode form (NFC). */
export function cleanName(name: string): string {
  return name.normalize("NFC").trim();
}

/** Accents dropped (đ → d too), lowercase, punctuation as spaces, single spaces. */
export function foldName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

/** "Ube Coffee (Large)", or just "Ube Coffee" for a single, unnamed size. */
export function sizeLabel(itemName: string, sizeName: string | undefined): string {
  return sizeName?.trim() ? `${itemName} (${sizeName})` : itemName;
}
```

### `server/adapters/pos/fixtures.ts` (new)

The CapheVietPOS placeholder café menu (not its generated Square export). All
prices are USD minor units; every `priceOverrides` is `[]`; no item has an
image or SKU.

Categories: `CAT-coffee` "Cà phê", `CAT-tea` "Trà", `CAT-blended` "Đá xay",
`CAT-pastry` "Bánh".

Modifier groups (option `modifierGroupId` is its group's id):

- `MG-sugar` "Mức đường (Sugar level)", required, min 1, max 1: `MO-sugar-0`
  "0%", `MO-sugar-30` "30%", `MO-sugar-50` "50%", `MO-sugar-70` "70%",
  `MO-sugar-100` "100%", each +0.
- `MG-ice` "Mức đá (Ice level)", required, min 1, max 1: `MO-ice-0` "Không đá",
  `MO-ice-50` "Ít đá", `MO-ice-100` "Đá bình thường", each +0.
- `MG-topping` "Topping", not required, min 0, max 3: `MO-top-boba` "Trân châu"
  +75, `MO-top-jelly` "Thạch" +75, `MO-top-cheese` "Kem cheese" +125.

Items (variation id, name, price):

| id | name | description | category | modifier groups | archived | variations |
|---|---|---|---|---|---|---|
| `ITEM-cf-sua-da` | Cà phê sữa đá | Vietnamese iced coffee with condensed milk | CAT-coffee | MG-sugar, MG-ice, MG-topping | no | `VAR-cf-sua-da-M` M 450; `VAR-cf-sua-da-L` L 525 |
| `ITEM-cf-den-da` | Cà phê đen đá | Vietnamese iced black coffee | CAT-coffee | MG-sugar, MG-ice | no | `VAR-cf-den-da-M` M 400; `VAR-cf-den-da-L` L 475 |
| `ITEM-bac-xiu` | Bạc xỉu | Milk-forward Vietnamese coffee | CAT-coffee | MG-sugar, MG-ice, MG-topping | no | `VAR-bac-xiu-M` M 475; `VAR-bac-xiu-L` L 550 |
| `ITEM-tra-dao` | Trà đào cam sả | Peach, orange & lemongrass iced tea | CAT-tea | MG-sugar, MG-ice, MG-topping | no | `VAR-tra-dao-M` M 500; `VAR-tra-dao-L` L 575 |
| `ITEM-cf-coconut` | Cà phê cốt dừa | Blended coconut coffee | CAT-blended | MG-sugar, MG-topping | no | `VAR-cf-coconut-L` L 650 |
| `ITEM-banh-mi-thit` | Bánh mì thịt | Vietnamese pork sandwich | CAT-pastry | none | no | `VAR-banh-mi-thit-1` Regular 695 |
| `ITEM-che-ba-mau` | Chè ba màu | Three-color dessert (seasonal, archived) | CAT-pastry | none | yes | `VAR-che-ba-mau-1` Regular 550 |

### `server/adapters/pos/InMemoryPosMenu.ts` (new)

`export function createInMemoryPosMenu(): PosMenu`, over a private deep copy of
the fixtures, applying CapheVietPOS's menu rules (from its
`InMemoryMenuAdapter.ts` and `server/menu/rules.ts`), with no artificial
latency. Expected failures reject with `PosMenuError`:

- Unknown item, variation, category or modifier group id: `not_found`, message
  like `Item not found: <id>` (also for unknown category or group ids passed to
  `createItem` and `updateItem`).
- Names (item, size, category) are stored with `cleanName`; an empty result is
  `validation` (`Item name is required`, `Category name is required`,
  `Variation name is required`).
- `createCategory`, and `renameCategory` (ignoring the category itself), refuse
  a name whose `foldName` equals an existing category's: `A category named
  "<existing>" already exists.` This is deliberately stricter than CapheVietPOS,
  which only refuses same-spelling names.
- `createItem` needs at least one variation, and no two of its variations may
  fold to the same name. `addVariation`, and `updateVariation` with a name,
  refuse a size name that folds to another size of the same item.
- `updateItem`: `description` is trimmed and an empty one is removed;
  `categoryId: null` clears the category; `modifierGroupIds` replaces the list.
  `updateVariation`: `sku` trimmed, empty or `null` clears it.
- `deleteCategory` is refused while any item, archived or not, is in it;
  `deleteModifierGroup` while any item uses it. Message shape from CapheVietPOS:
  `2 items use this category (Cà phê sữa đá, Bạc xỉu). Move them to another
  category first.` (at most three names, then `, and N more`; for groups, `Detach
  it from them first.`).
- `removeVariation` is refused for an item's last size: `An item must keep at
  least one variation`.
- `setVariationPrice` refuses a non-integer or negative amount.
- `setItemImage` accepts only an `http:` or `https:` URL (trimmed), or `null` to
  clear. Unlike CapheVietPOS, `data:` URIs are refused.
- `listItems()` leaves out archived items unless `includeArchived: true`.
- New ids are unique within an instance (any readable scheme, such as `CAT-1`).
- Every returned object is a copy: mutating it never changes the store. Two
  instances never share state.

## Acceptance

- `PosMenu` declares exactly the fifteen methods above with those signatures,
  and the types keep CapheVietPOS's field names and optionality.
- `createInMemoryPosMenu()` is assignable to `PosMenu`, and its method names
  are exactly the fifteen (checked by a test).
- Fresh instances start from the fixtures and are independent; returned objects
  are copies.
- Every refusal listed in Scope rejects with `PosMenuError` and the stated
  `code`; unknown ids reject with `not_found`.
- `foldName("Cà phê Sữa Đá")` and `foldName("ca phe sua da")` are both
  `"ca phe sua da"`; `sizeLabel("Bạc xỉu", "L")` is `"Bạc xỉu (L)"` and
  `sizeLabel("X", "")` is `"X"`.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including the new `server/text/names.test.ts` (accents,
  `đ`, case and punctuation fold alike; `sizeLabel` formats) and
  `server/adapters/pos/InMemoryPosMenu.test.ts` (method names, independence,
  copies, empty and duplicate names, in-use deletes, last size, `not_found`,
  archived filtering, image URL check). Database tests skip without
  `DATABASE_URL`.
- `npm run build:api` succeeds.

## After merge

- Compare `server/ports/PosMenu.ts` with CapheVietPOS's `shared/MenuStore.ts` and `shared/domain/menu.ts` at 60764e5 by hand (local only).
