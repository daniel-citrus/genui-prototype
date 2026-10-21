import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PosMenuError, type PosMenu } from "../../ports/PosMenu";
import * as fixtures from "./fixtures";
import { createInMemoryPosMenu } from "./InMemoryPosMenu";

const usd = (amount: number) => ({ amount, currency: "USD" });

function refused(promise: Promise<unknown>, code: PosMenuError["code"], message?: string) {
  return assert.rejects(promise, (err) => {
    assert.ok(err instanceof PosMenuError);
    assert.equal(err.name, "PosMenuError");
    assert.equal(err.code, code);
    if (message !== undefined) assert.equal(err.message, message);
    return true;
  });
}

const findItem = async (menu: PosMenu, id: string) =>
  (await menu.listItems({ includeArchived: true })).find((i) => i.id === id);

describe("createInMemoryPosMenu", () => {
  it("has exactly the fifteen PosMenu methods", () => {
    const menu: PosMenu = createInMemoryPosMenu();
    assert.deepEqual(Object.keys(menu).sort(), [
      "addVariation",
      "createCategory",
      "createItem",
      "deleteCategory",
      "deleteModifierGroup",
      "listCategories",
      "listItems",
      "listModifierGroups",
      "removeVariation",
      "renameCategory",
      "setItemArchived",
      "setItemImage",
      "setVariationPrice",
      "updateItem",
      "updateVariation",
    ]);
  });

  it("starts from the demo menu", async () => {
    const menu = createInMemoryPosMenu();
    assert.deepEqual(await menu.listCategories(), fixtures.categories);
    assert.deepEqual(await menu.listModifierGroups(), fixtures.modifierGroups);
    assert.deepEqual(await menu.listItems({ includeArchived: true }), fixtures.items);
  });

  it("keeps instances independent and the fixtures unchanged", async () => {
    const a = createInMemoryPosMenu();
    await a.renameCategory("CAT-tea", "Trà sữa");
    await a.setVariationPrice("ITEM-bac-xiu", "VAR-bac-xiu-M", usd(500));
    const b = createInMemoryPosMenu();
    assert.equal((await a.listCategories())[1]?.name, "Trà sữa");
    assert.deepEqual(await b.listCategories(), fixtures.categories);
    assert.deepEqual(await b.listItems({ includeArchived: true }), fixtures.items);
    assert.equal(fixtures.categories[1]?.name, "Trà");
  });

  it("returns copies, so changing them never changes the store", async () => {
    const menu = createInMemoryPosMenu();
    const [item] = await menu.listItems();
    assert.ok(item);
    item.name = "Changed";
    item.variations[0].price.amount = 1;
    const [group] = await menu.listModifierGroups();
    assert.ok(group);
    group.options.length = 0;
    const created = await menu.createCategory({ name: "Sinh tố" });
    created.name = "Changed";

    assert.deepEqual(await menu.listModifierGroups(), fixtures.modifierGroups);
    const stored = await findItem(menu, item.id);
    assert.equal(stored?.name, fixtures.items[0]?.name);
    assert.equal(stored?.variations[0]?.price.amount, 450);
    assert.equal((await menu.listCategories()).at(-1)?.name, "Sinh tố");
  });

  it("leaves archived items out unless asked", async () => {
    const menu = createInMemoryPosMenu();
    const ids = async (includeArchived?: boolean) =>
      (await menu.listItems({ includeArchived })).map((i) => i.id);
    assert.ok(!(await ids()).includes("ITEM-che-ba-mau"));
    assert.ok((await ids(true)).includes("ITEM-che-ba-mau"));

    await menu.setItemArchived("ITEM-che-ba-mau", false);
    await menu.setItemArchived("ITEM-bac-xiu", true);
    assert.ok((await ids()).includes("ITEM-che-ba-mau"));
    assert.ok(!(await ids()).includes("ITEM-bac-xiu"));
  });
});

describe("categories", () => {
  it("stores names trimmed and NFC, with new unique ids", async () => {
    const menu = createInMemoryPosMenu();
    const first = await menu.createCategory({ name: "  Sinh tố " });
    const second = await menu.createCategory({ name: "Nước ép" });
    assert.equal(first.name, "Sinh tố");
    assert.notEqual(first.id, second.id);
    assert.deepEqual((await menu.listCategories()).slice(-2), [first, second]);
  });

  it("refuses an empty name", async () => {
    const menu = createInMemoryPosMenu();
    await refused(menu.createCategory({ name: "  " }), "validation", "Category name is required");
    await refused(menu.renameCategory("CAT-tea", ""), "validation", "Category name is required");
  });

  it("refuses a name that folds to another category's", async () => {
    const menu = createInMemoryPosMenu();
    const exists = 'A category named "Cà phê" already exists.';
    await refused(menu.createCategory({ name: "ca phe" }), "validation", exists);
    await refused(menu.renameCategory("CAT-tea", "CÀ-PHÊ"), "validation", exists);
    assert.equal((await menu.renameCategory("CAT-coffee", "cà phê")).name, "cà phê");
  });

  it("refuses to delete a category any item is in, archived or not", async () => {
    const menu = createInMemoryPosMenu();
    await refused(
      menu.deleteCategory("CAT-coffee"),
      "validation",
      "3 items use this category (Cà phê sữa đá, Cà phê đen đá, Bạc xỉu). Move them to another category first.",
    );
    await refused(
      menu.deleteCategory("CAT-pastry"),
      "validation",
      "2 items use this category (Bánh mì thịt, Chè ba màu). Move them to another category first.",
    );
    await menu.updateItem("ITEM-tra-dao", { categoryId: null });
    await menu.deleteCategory("CAT-tea");
    assert.ok(!(await menu.listCategories()).some((c) => c.id === "CAT-tea"));
  });
});

describe("modifier groups", () => {
  it("refuses to delete a group any item uses", async () => {
    const menu = createInMemoryPosMenu();
    await refused(
      menu.deleteModifierGroup("MG-sugar"),
      "validation",
      "5 items use this modifier group (Cà phê sữa đá, Cà phê đen đá, Bạc xỉu, and 2 more). Detach it from them first.",
    );
    for (const id of ["ITEM-cf-sua-da", "ITEM-cf-den-da", "ITEM-bac-xiu", "ITEM-tra-dao"]) {
      await menu.updateItem(id, { modifierGroupIds: ["MG-sugar"] });
    }
    await menu.deleteModifierGroup("MG-ice");
    assert.deepEqual(
      (await menu.listModifierGroups()).map((g) => g.id),
      ["MG-sugar", "MG-topping"],
    );
  });
});

describe("items", () => {
  it("creates an item with cleaned names and its sizes", async () => {
    const menu = createInMemoryPosMenu();
    const item = await menu.createItem({
      name: " Trà sữa ",
      description: "  ",
      categoryId: "CAT-tea",
      modifierGroupIds: ["MG-sugar"],
      variations: [
        { name: " M ", price: usd(500), sku: " TS-M " },
        { name: "L", price: usd(575), sku: " " },
      ],
    });
    assert.equal(item.name, "Trà sữa");
    assert.equal("description" in item, false);
    assert.equal(item.categoryId, "CAT-tea");
    assert.deepEqual(item.modifierGroupIds, ["MG-sugar"]);
    assert.equal(item.archived, false);
    assert.deepEqual(
      item.variations.map(({ itemId, name, price, sku, priceOverrides }) => ({ itemId, name, price, sku, priceOverrides })),
      [
        { itemId: item.id, name: "M", price: usd(500), sku: "TS-M", priceOverrides: [] },
        { itemId: item.id, name: "L", price: usd(575), sku: undefined, priceOverrides: [] },
      ],
    );
    assert.notEqual(item.variations[0]?.id, item.variations[1]?.id);
    assert.deepEqual(await findItem(menu, item.id), item);
  });

  it("refuses an empty name, no sizes, or two sizes that fold alike", async () => {
    const menu = createInMemoryPosMenu();
    const size = { name: "M", price: usd(500) };
    await refused(menu.createItem({ name: " ", variations: [size] }), "validation", "Item name is required");
    await refused(menu.createItem({ name: "Trà", variations: [] }), "validation");
    await refused(
      menu.createItem({ name: "Trà", variations: [size, { name: "m", price: usd(600) }] }),
      "validation",
      '"m" and "M" are the same size ignoring accents.',
    );
    await refused(
      menu.createItem({ name: "Trà", variations: [{ name: "", price: usd(500) }] }),
      "validation",
      "Variation name is required",
    );
    await refused(menu.updateItem("ITEM-bac-xiu", { name: "" }), "validation", "Item name is required");
    assert.equal((await menu.listItems({ includeArchived: true })).length, fixtures.items.length);
  });

  it("updates fields, clearing the description and category", async () => {
    const menu = createInMemoryPosMenu();
    const item = await menu.updateItem("ITEM-bac-xiu", {
      name: " Bạc xỉu nóng ",
      description: " ",
      categoryId: null,
      modifierGroupIds: ["MG-topping"],
    });
    assert.equal(item.name, "Bạc xỉu nóng");
    assert.equal("description" in item, false);
    assert.equal("categoryId" in item, false);
    assert.deepEqual(item.modifierGroupIds, ["MG-topping"]);

    const moved = await menu.updateItem("ITEM-bac-xiu", { description: " Hot ", categoryId: "CAT-tea" });
    assert.equal(moved.description, "Hot");
    assert.equal(moved.categoryId, "CAT-tea");
  });

  it("changes nothing when a patch is refused", async () => {
    const menu = createInMemoryPosMenu();
    await refused(menu.updateItem("ITEM-bac-xiu", { name: "New", categoryId: "CAT-nope" }), "not_found");
    assert.deepEqual(await findItem(menu, "ITEM-bac-xiu"), fixtures.items[2]);
  });

  it("sets an image only from an http or https URL", async () => {
    const menu = createInMemoryPosMenu();
    const set = await menu.setItemImage("ITEM-bac-xiu", " https://example.com/bac-xiu.png ");
    assert.equal(set.imageUrl, "https://example.com/bac-xiu.png");
    assert.equal(
      (await menu.setItemImage("ITEM-bac-xiu", "http://example.com/a.jpg")).imageUrl,
      "http://example.com/a.jpg",
    );
    for (const url of ["data:image/png;base64,AAAA", "ftp://example.com/a.png", "javascript:alert(1)", "bac-xiu.png", ""]) {
      await refused(menu.setItemImage("ITEM-bac-xiu", url), "validation");
    }
    const cleared = await menu.setItemImage("ITEM-bac-xiu", null);
    assert.equal("imageUrl" in cleared, false);
  });
});

describe("variations", () => {
  it("adds a size, refusing one that folds to an existing size", async () => {
    const menu = createInMemoryPosMenu();
    const item = await menu.addVariation("ITEM-cf-coconut", { name: " M ", price: usd(575) });
    assert.deepEqual(item.variations.map((v) => v.name), ["L", "M"]);
    await refused(
      menu.addVariation("ITEM-cf-coconut", { name: "l", price: usd(600) }),
      "validation",
      '"l" and "L" are the same size ignoring accents.',
    );
    await refused(menu.addVariation("ITEM-cf-coconut", { name: " ", price: usd(600) }), "validation");
  });

  it("renames a size and sets or clears its SKU", async () => {
    const menu = createInMemoryPosMenu();
    await refused(menu.updateVariation("ITEM-bac-xiu", "VAR-bac-xiu-M", { name: "l" }), "validation");
    await refused(menu.updateVariation("ITEM-bac-xiu", "VAR-bac-xiu-M", { name: " " }), "validation");
    const renamed = await menu.updateVariation("ITEM-bac-xiu", "VAR-bac-xiu-M", { name: "m", sku: " BX-M " });
    assert.deepEqual(renamed.variations[0], { ...fixtures.items[2]?.variations[0], name: "m", sku: "BX-M" });

    const blank = await menu.updateVariation("ITEM-bac-xiu", "VAR-bac-xiu-M", { sku: " " });
    assert.equal("sku" in blank.variations[0], false);
    await menu.updateVariation("ITEM-bac-xiu", "VAR-bac-xiu-M", { sku: "BX-M" });
    const cleared = await menu.updateVariation("ITEM-bac-xiu", "VAR-bac-xiu-M", { sku: null });
    assert.equal("sku" in cleared.variations[0], false);
  });

  it("refuses to remove an item's last size", async () => {
    const menu = createInMemoryPosMenu();
    await refused(
      menu.removeVariation("ITEM-cf-coconut", "VAR-cf-coconut-L"),
      "validation",
      "An item must keep at least one variation",
    );
    const item = await menu.removeVariation("ITEM-bac-xiu", "VAR-bac-xiu-M");
    assert.deepEqual(item.variations.map((v) => v.id), ["VAR-bac-xiu-L"]);
    await refused(menu.removeVariation("ITEM-bac-xiu", "VAR-bac-xiu-L"), "validation");
  });

  it("sets a price only to a whole, non-negative amount", async () => {
    const menu = createInMemoryPosMenu();
    await refused(menu.setVariationPrice("ITEM-bac-xiu", "VAR-bac-xiu-M", usd(4.5)), "validation");
    await refused(menu.setVariationPrice("ITEM-bac-xiu", "VAR-bac-xiu-M", usd(-1)), "validation");
    await refused(menu.addVariation("ITEM-bac-xiu", { name: "XL", price: usd(-1) }), "validation");
    const item = await menu.setVariationPrice("ITEM-bac-xiu", "VAR-bac-xiu-M", usd(0));
    assert.deepEqual(item.variations[0]?.price, usd(0));
  });
});

describe("unknown ids", () => {
  it("reject with not_found", async () => {
    const menu = createInMemoryPosMenu();
    const size = { name: "XL", price: usd(500) };
    const calls: [() => Promise<unknown>, string][] = [
      [() => menu.renameCategory("CAT-nope", "X"), "Category not found: CAT-nope"],
      [() => menu.deleteCategory("CAT-nope"), "Category not found: CAT-nope"],
      [() => menu.deleteModifierGroup("MG-nope"), "Modifier group not found: MG-nope"],
      [() => menu.createItem({ name: "X", categoryId: "CAT-nope", variations: [size] }), "Category not found: CAT-nope"],
      [() => menu.createItem({ name: "X", modifierGroupIds: ["MG-nope"], variations: [size] }), "Modifier group not found: MG-nope"],
      [() => menu.updateItem("ITEM-nope", {}), "Item not found: ITEM-nope"],
      [() => menu.updateItem("ITEM-bac-xiu", { categoryId: "CAT-nope" }), "Category not found: CAT-nope"],
      [() => menu.updateItem("ITEM-bac-xiu", { modifierGroupIds: ["MG-nope"] }), "Modifier group not found: MG-nope"],
      [() => menu.setItemArchived("ITEM-nope", true), "Item not found: ITEM-nope"],
      [() => menu.setItemImage("ITEM-nope", null), "Item not found: ITEM-nope"],
      [() => menu.addVariation("ITEM-nope", size), "Item not found: ITEM-nope"],
      [() => menu.updateVariation("ITEM-nope", "VAR-bac-xiu-M", {}), "Item not found: ITEM-nope"],
      [() => menu.updateVariation("ITEM-bac-xiu", "VAR-nope", {}), "Variation not found: VAR-nope"],
      [() => menu.removeVariation("ITEM-cf-coconut", "VAR-nope"), "Variation not found: VAR-nope"],
      [() => menu.setVariationPrice("ITEM-bac-xiu", "VAR-cf-sua-da-M", usd(500)), "Variation not found: VAR-cf-sua-da-M"],
    ];
    for (const [call, message] of calls) await refused(call(), "not_found", message);
  });
});
