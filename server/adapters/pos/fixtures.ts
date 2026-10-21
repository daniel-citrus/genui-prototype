import type { Category, Item, ModifierGroup } from "../../ports/PosMenu";

/**
 * The demo café menu: CapheVietPOS's placeholder menu (`server/menu/memory/
 * fixtures.ts` at commit 60764e5), not its Square export. Prices are USD
 * minor units. `createInMemoryPosMenu` copies it, so nothing here changes.
 */

const usd = (amount: number) => ({ amount, currency: "USD" });

export const categories: Category[] = [
  { id: "CAT-coffee", name: "Cà phê" },
  { id: "CAT-tea", name: "Trà" },
  { id: "CAT-blended", name: "Đá xay" },
  { id: "CAT-pastry", name: "Bánh" },
];

export const modifierGroups: ModifierGroup[] = [
  {
    id: "MG-sugar",
    name: "Mức đường (Sugar level)",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    options: [
      { id: "MO-sugar-0", modifierGroupId: "MG-sugar", name: "0%", priceDelta: usd(0) },
      { id: "MO-sugar-30", modifierGroupId: "MG-sugar", name: "30%", priceDelta: usd(0) },
      { id: "MO-sugar-50", modifierGroupId: "MG-sugar", name: "50%", priceDelta: usd(0) },
      { id: "MO-sugar-70", modifierGroupId: "MG-sugar", name: "70%", priceDelta: usd(0) },
      { id: "MO-sugar-100", modifierGroupId: "MG-sugar", name: "100%", priceDelta: usd(0) },
    ],
  },
  {
    id: "MG-ice",
    name: "Mức đá (Ice level)",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    options: [
      { id: "MO-ice-0", modifierGroupId: "MG-ice", name: "Không đá", priceDelta: usd(0) },
      { id: "MO-ice-50", modifierGroupId: "MG-ice", name: "Ít đá", priceDelta: usd(0) },
      { id: "MO-ice-100", modifierGroupId: "MG-ice", name: "Đá bình thường", priceDelta: usd(0) },
    ],
  },
  {
    id: "MG-topping",
    name: "Topping",
    required: false,
    minSelect: 0,
    maxSelect: 3,
    options: [
      { id: "MO-top-boba", modifierGroupId: "MG-topping", name: "Trân châu", priceDelta: usd(75) },
      { id: "MO-top-jelly", modifierGroupId: "MG-topping", name: "Thạch", priceDelta: usd(75) },
      { id: "MO-top-cheese", modifierGroupId: "MG-topping", name: "Kem cheese", priceDelta: usd(125) },
    ],
  },
];

export const items: Item[] = [
  {
    id: "ITEM-cf-sua-da",
    name: "Cà phê sữa đá",
    description: "Vietnamese iced coffee with condensed milk",
    categoryId: "CAT-coffee",
    modifierGroupIds: ["MG-sugar", "MG-ice", "MG-topping"],
    archived: false,
    variations: [
      { id: "VAR-cf-sua-da-M", itemId: "ITEM-cf-sua-da", name: "M", price: usd(450), priceOverrides: [] },
      { id: "VAR-cf-sua-da-L", itemId: "ITEM-cf-sua-da", name: "L", price: usd(525), priceOverrides: [] },
    ],
  },
  {
    id: "ITEM-cf-den-da",
    name: "Cà phê đen đá",
    description: "Vietnamese iced black coffee",
    categoryId: "CAT-coffee",
    modifierGroupIds: ["MG-sugar", "MG-ice"],
    archived: false,
    variations: [
      { id: "VAR-cf-den-da-M", itemId: "ITEM-cf-den-da", name: "M", price: usd(400), priceOverrides: [] },
      { id: "VAR-cf-den-da-L", itemId: "ITEM-cf-den-da", name: "L", price: usd(475), priceOverrides: [] },
    ],
  },
  {
    id: "ITEM-bac-xiu",
    name: "Bạc xỉu",
    description: "Milk-forward Vietnamese coffee",
    categoryId: "CAT-coffee",
    modifierGroupIds: ["MG-sugar", "MG-ice", "MG-topping"],
    archived: false,
    variations: [
      { id: "VAR-bac-xiu-M", itemId: "ITEM-bac-xiu", name: "M", price: usd(475), priceOverrides: [] },
      { id: "VAR-bac-xiu-L", itemId: "ITEM-bac-xiu", name: "L", price: usd(550), priceOverrides: [] },
    ],
  },
  {
    id: "ITEM-tra-dao",
    name: "Trà đào cam sả",
    description: "Peach, orange & lemongrass iced tea",
    categoryId: "CAT-tea",
    modifierGroupIds: ["MG-sugar", "MG-ice", "MG-topping"],
    archived: false,
    variations: [
      { id: "VAR-tra-dao-M", itemId: "ITEM-tra-dao", name: "M", price: usd(500), priceOverrides: [] },
      { id: "VAR-tra-dao-L", itemId: "ITEM-tra-dao", name: "L", price: usd(575), priceOverrides: [] },
    ],
  },
  {
    id: "ITEM-cf-coconut",
    name: "Cà phê cốt dừa",
    description: "Blended coconut coffee",
    categoryId: "CAT-blended",
    modifierGroupIds: ["MG-sugar", "MG-topping"],
    archived: false,
    variations: [
      { id: "VAR-cf-coconut-L", itemId: "ITEM-cf-coconut", name: "L", price: usd(650), priceOverrides: [] },
    ],
  },
  {
    id: "ITEM-banh-mi-thit",
    name: "Bánh mì thịt",
    description: "Vietnamese pork sandwich",
    categoryId: "CAT-pastry",
    modifierGroupIds: [],
    archived: false,
    variations: [
      { id: "VAR-banh-mi-thit-1", itemId: "ITEM-banh-mi-thit", name: "Regular", price: usd(695), priceOverrides: [] },
    ],
  },
  {
    id: "ITEM-che-ba-mau",
    name: "Chè ba màu",
    description: "Three-color dessert (seasonal, archived)",
    categoryId: "CAT-pastry",
    modifierGroupIds: [],
    archived: true,
    variations: [
      { id: "VAR-che-ba-mau-1", itemId: "ITEM-che-ba-mau", name: "Regular", price: usd(550), priceOverrides: [] },
    ],
  },
];
