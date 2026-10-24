import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UiNode } from "shared/ui";
import { createInMemoryPosMenu } from "../../adapters/pos/InMemoryPosMenu";
import type { ToolLogger } from "../../agent/tools";
import { catalog } from "../../catalog/components";
import { InMemoryComponentRepository } from "../../ports/fakes/InMemoryComponentRepository";
import type { Item, PosMenu } from "../../ports/PosMenu";
import { checkActionRequest } from "../../ui/checkAction";
import { validateUiTree } from "../../ui/validateTree";
import { createActions } from "../index";
import { createActionRegistry } from "../registry";
import type { ActionContext } from "../types";
import { createMenuActions } from "./index";

const signal = new AbortController().signal;

function makeCtx() {
  const errors: unknown[] = [];
  const log: ToolLogger = {
    info() {},
    debug() {},
    warn() {},
    error(obj) {
      errors.push(obj);
    },
  };
  const ctx: ActionContext = { designId: "design-1", signal, log };
  return { ctx, errors };
}

/** A registry over `menu` (a fresh demo menu by default), as `server/index.ts` builds it. */
function setup(menu: PosMenu = createInMemoryPosMenu()) {
  const registry = createActionRegistry([...createActions(), ...createMenuActions(menu)]);
  const { ctx, errors } = makeCtx();
  const run = (action: string, values: Record<string, string | boolean>) => registry.run(action, values, ctx);
  return { menu, registry, run, errors };
}

/** `menu` recording the name of every method called. */
function spied(menu: PosMenu): { menu: PosMenu; calls: string[] } {
  const calls: string[] = [];
  const wrapped = Object.fromEntries(
    Object.entries(menu).map(([key, method]: [string, (...args: unknown[]) => unknown]) => [
      key,
      (...args: unknown[]) => {
        calls.push(key);
        return method(...args);
      },
    ]),
  );
  return { menu: wrapped as unknown as PosMenu, calls };
}

async function item(menu: PosMenu, name: string): Promise<Item> {
  const found = (await menu.listItems({ includeArchived: true })).find((i) => i.name === name);
  assert.ok(found, `no item "${name}"`);
  return found;
}

const ok = (message: string) => ({ ok: true, message });
const refused = (message: string) => ({ ok: false, message });

const ITEMS = "menu_items";
const SIZES = "menu_item_sizes";
const CATEGORIES = "menu_categories";
const GROUPS = "menu_modifier_groups";

/** name, area/operation, inputs (`*` = required), dropdown sources, confirm. */
const TABLE: [string, string, string, Record<string, string>, string?][] = [
  ["menu_create_item", "items/create", "name* size* price* description category", { category: CATEGORIES }],
  ["menu_update_item", "items/edit", "item* name description category", { item: ITEMS, category: CATEGORIES }],
  ["menu_set_item_archived", "items/archive", "item* archived*", { item: ITEMS }],
  ["menu_set_item_image", "items/edit", "item* image_url", { item: ITEMS }],
  ["menu_attach_modifier_group", "modifier_groups/attach", "item* group*", { item: ITEMS, group: GROUPS }],
  ["menu_detach_modifier_group", "modifier_groups/detach", "item* group*", { item: ITEMS, group: GROUPS }],
  ["menu_add_size", "sizes/create", "item* name* price*", { item: ITEMS }],
  ["menu_update_size", "sizes/edit", "size* name sku", { size: SIZES }],
  ["menu_set_size_price", "prices/edit", "size* price*", { size: SIZES }],
  ["menu_remove_size", "sizes/delete", "size*", { size: SIZES }, "Remove the size {size}? This can't be undone."],
  ["menu_create_category", "categories/create", "name*", {}],
  ["menu_rename_category", "categories/edit", "category* name*", { category: CATEGORIES }],
  [
    "menu_delete_category",
    "categories/delete",
    "category*",
    { category: CATEGORIES },
    "Delete the category {category}? This can't be undone.",
  ],
  [
    "menu_delete_modifier_group",
    "modifier_groups/delete",
    "group*",
    { group: GROUPS },
    "Delete the modifier group {group}? This can't be undone.",
  ],
];

/** Each action with values it runs on, and the PosMenu methods it then calls. */
const CALLS: [string, Record<string, string | boolean>, string[]][] = [
  ["menu_create_item", { name: "Phở", size: "M", price: "9", category: "Trà" }, ["listCategories", "createItem"]],
  ["menu_update_item", { item: "Bạc xỉu", category: "Trà" }, ["listItems", "listCategories", "updateItem"]],
  ["menu_set_item_archived", { item: "Bạc xỉu", archived: true }, ["listItems", "setItemArchived"]],
  ["menu_set_item_image", { item: "Bạc xỉu" }, ["listItems", "setItemImage"]],
  [
    "menu_attach_modifier_group",
    { item: "Bánh mì thịt", group: "Topping" },
    ["listItems", "listModifierGroups", "updateItem"],
  ],
  [
    "menu_detach_modifier_group",
    { item: "Bạc xỉu", group: "Topping" },
    ["listItems", "listModifierGroups", "updateItem"],
  ],
  ["menu_add_size", { item: "Bạc xỉu", name: "XL", price: "6" }, ["listItems", "addVariation"]],
  ["menu_update_size", { size: "Bạc xỉu (L)", sku: "BX-L" }, ["listItems", "updateVariation"]],
  ["menu_set_size_price", { size: "Bạc xỉu (L)", price: "6" }, ["listItems", "setVariationPrice"]],
  ["menu_remove_size", { size: "Bạc xỉu (L)" }, ["listItems", "removeVariation"]],
  ["menu_create_category", { name: "Nước ép" }, ["createCategory"]],
  ["menu_rename_category", { category: "Trà", name: "Tea" }, ["listCategories", "renameCategory"]],
  ["menu_delete_category", { category: "Trà" }, ["listCategories", "deleteCategory"]],
  ["menu_delete_modifier_group", { group: "Topping" }, ["listModifierGroups", "deleteModifierGroup"]],
];

describe("menu actions: specs", () => {
  it("register after demo_echo, in table order, with their area, operation, inputs, choices and confirm", () => {
    const { registry } = setup();
    assert.deepEqual(
      registry.specs.map((s) => s.name),
      ["demo_echo", ...TABLE.map(([name]) => name)],
    );
    for (const [i, [name, areaOperation, inputs, choices, confirm]] of TABLE.entries()) {
      const spec = registry.specs[i + 1];
      const schema = spec.input_schema as { properties: Record<string, unknown>; required: string[] };
      const names = inputs.split(" ");
      assert.equal(`${spec.area}/${spec.operation}`, areaOperation, name);
      assert.deepEqual(spec.choices ?? {}, choices, name);
      assert.equal(spec.confirm, confirm, name);
      assert.deepEqual(
        Object.keys(schema.properties),
        names.map((n) => n.replace("*", "")),
        name,
      );
      assert.deepEqual(
        schema.required,
        names.filter((n) => n.endsWith("*")).map((n) => n.slice(0, -1)),
        name,
      );
    }
  });

  it("have closed schemas of described strings and booleans, names capped at 100 and other text at 1000", () => {
    const { registry } = setup();
    for (const spec of registry.specs.slice(1)) {
      const schema = spec.input_schema as {
        additionalProperties: unknown;
        properties: Record<string, Record<string, unknown>>;
      };
      assert.equal(schema.additionalProperties, false, spec.name);
      assert.match(spec.description, /Reads /, spec.name);
      for (const [key, prop] of Object.entries(schema.properties)) {
        const where = `${spec.name}.${key}`;
        assert.equal(typeof prop.description, "string", where);
        if (key === "archived") {
          assert.equal(prop.type, "boolean", where);
          continue;
        }
        const isName =
          ["name", "item", "category", "group"].includes(key) || (spec.name === "menu_create_item" && key === "size");
        assert.equal(prop.type, "string", where);
        assert.equal(prop.maxLength, isName ? 100 : 1000, where);
      }
    }
  });

  it("share one source object per dropdown kind within a createMenuActions call", () => {
    const definitions = createMenuActions(createInMemoryPosMenu());
    const sources = new Map<string, Set<unknown>>();
    for (const def of definitions) {
      for (const source of Object.values(def.choices ?? {})) {
        sources.set(source.name, (sources.get(source.name) ?? new Set()).add(source));
      }
    }
    assert.deepEqual([...sources.keys()].sort(), [CATEGORIES, SIZES, ITEMS, GROUPS]);
    for (const [name, objects] of sources) assert.equal(objects.size, 1, name);
  });
});

describe("menu actions: dropdown sources", () => {
  it("list the demo menu's names sorted by folded name, archived items and Item (Size) labels included", async () => {
    const { registry } = setup();
    const list = (source: string) => registry.listChoices(source, signal);
    assert.deepEqual(await list("menu_items"), [
      "Bạc xỉu",
      "Bánh mì thịt",
      "Cà phê cốt dừa",
      "Cà phê đen đá",
      "Cà phê sữa đá",
      "Chè ba màu",
      "Trà đào cam sả",
    ]);
    assert.deepEqual(await list("menu_item_sizes"), [
      "Bạc xỉu (L)",
      "Bạc xỉu (M)",
      "Bánh mì thịt (Regular)",
      "Cà phê cốt dừa (L)",
      "Cà phê đen đá (L)",
      "Cà phê đen đá (M)",
      "Cà phê sữa đá (L)",
      "Cà phê sữa đá (M)",
      "Chè ba màu (Regular)",
      "Trà đào cam sả (L)",
      "Trà đào cam sả (M)",
    ]);
    assert.deepEqual(await list("menu_categories"), ["Bánh", "Cà phê", "Đá xay", "Trà"]);
    assert.deepEqual(await list("menu_modifier_groups"), [
      "Mức đá (Ice level)",
      "Mức đường (Sugar level)",
      "Topping",
    ]);
  });

  it("keep the menu's order for names that fold the same", async () => {
    const menu: PosMenu = {
      ...createInMemoryPosMenu(),
      listCategories: async () => [
        { id: "a", name: "Trà" },
        { id: "b", name: "Bánh" },
        { id: "c", name: "Tra" },
      ],
    };
    assert.deepEqual(await setup(menu).registry.listChoices("menu_categories", signal), ["Bánh", "Trà", "Tra"]);
  });

  it("show changes made by the actions", async () => {
    const { registry, run } = setup();
    await run("menu_rename_category", { category: "Bánh", name: "Ăn vặt" });
    assert.deepEqual(await registry.listChoices(CATEGORIES, signal), ["Ăn vặt", "Cà phê", "Đá xay", "Trà"]);
  });
});

describe("menu actions: happy paths", () => {
  it("call exactly the PosMenu methods in the table", async () => {
    for (const [action, values, expected] of CALLS) {
      const { menu, calls } = spied(createInMemoryPosMenu());
      await setup(menu).run(action, values);
      assert.deepEqual(calls, expected, action);
    }
  });

  it("menu_create_item creates an item with one size, optionally described and in a category", async () => {
    const { menu, run } = setup();
    assert.deepEqual(
      await run("menu_create_item", {
        name: " Cà phê muối ",
        size: "M",
        price: "$5",
        description: "Salted cream coffee",
        category: "ca phe",
      }),
      ok('Created "Cà phê muối" in "Cà phê" with the size M at $5.00.'),
    );
    const created = await item(menu, "Cà phê muối");
    assert.equal(created.description, "Salted cream coffee");
    assert.equal(created.categoryId, "CAT-coffee");
    assert.deepEqual(
      created.variations.map((v) => [v.name, v.price.amount]),
      [["M", 500]],
    );

    assert.deepEqual(
      await run("menu_create_item", { name: "Trà sữa", size: "L", price: "4.5", description: "", category: "" }),
      ok('Created "Trà sữa" with the size L at $4.50.'),
    );
    const plain = await item(menu, "Trà sữa");
    assert.equal(plain.description, undefined);
    assert.equal(plain.categoryId, undefined);
  });

  it("menu_update_item changes only the fields filled in and names them", async () => {
    const { menu, run } = setup();
    assert.deepEqual(
      await run("menu_update_item", { item: "Bạc xỉu", name: "", description: "Sweeter", category: "" }),
      ok('Updated "Bạc xỉu": description.'),
    );
    assert.deepEqual(
      await run("menu_update_item", { item: "bac xiu", name: "Bạc xỉu nóng", description: "Hot", category: "Tra" }),
      ok('Updated "Bạc xỉu" (now "Bạc xỉu nóng"): name, description, category.'),
    );
    const updated = await item(menu, "Bạc xỉu nóng");
    assert.equal(updated.description, "Hot");
    assert.equal(updated.categoryId, "CAT-tea");
  });

  it("menu_set_item_archived archives an item and brings an archived one back", async () => {
    const { menu, run } = setup();
    assert.deepEqual(
      await run("menu_set_item_archived", { item: "Bạc xỉu", archived: true }),
      ok('Archived "Bạc xỉu": it no longer shows on the menu.'),
    );
    assert.deepEqual(
      await run("menu_set_item_archived", { item: "Chè ba màu", archived: false }),
      ok('Unarchived "Chè ba màu": it shows on the menu again.'),
    );
    const shown = (await menu.listItems()).map((i) => i.name);
    assert.ok(!shown.includes("Bạc xỉu"));
    assert.ok(shown.includes("Chè ba màu"));
  });

  it("menu_set_item_image sets the image, and clears it when image_url is empty or missing", async () => {
    const { menu, run } = setup();
    assert.deepEqual(
      await run("menu_set_item_image", { item: "Bạc xỉu", image_url: "https://example.com/bx.jpg" }),
      ok('Set the image of "Bạc xỉu".'),
    );
    assert.equal((await item(menu, "Bạc xỉu")).imageUrl, "https://example.com/bx.jpg");
    assert.deepEqual(
      await run("menu_set_item_image", { item: "Bạc xỉu", image_url: "" }),
      ok('Cleared the image of "Bạc xỉu".'),
    );
    assert.equal((await item(menu, "Bạc xỉu")).imageUrl, undefined);
    await run("menu_set_item_image", { item: "Bạc xỉu", image_url: "https://example.com/bx.jpg" });
    assert.deepEqual(
      await run("menu_set_item_image", { item: "Bạc xỉu" }),
      ok('Cleared the image of "Bạc xỉu".'),
    );
    assert.equal((await item(menu, "Bạc xỉu")).imageUrl, undefined);
  });

  it("menu_attach_modifier_group offers a group, and says nothing changed when it already does", async () => {
    const { menu, run } = setup();
    assert.deepEqual(
      await run("menu_attach_modifier_group", { item: "Bánh mì thịt", group: "Topping" }),
      ok('"Bánh mì thịt" now offers "Topping".'),
    );
    assert.deepEqual((await item(menu, "Bánh mì thịt")).modifierGroupIds, ["MG-topping"]);
    assert.deepEqual(
      await run("menu_attach_modifier_group", { item: "Bánh mì thịt", group: "topping" }),
      ok('"Bánh mì thịt" already offers "Topping"; nothing changed.'),
    );
    assert.deepEqual((await item(menu, "Bánh mì thịt")).modifierGroupIds, ["MG-topping"]);
  });

  it("menu_detach_modifier_group stops offering a group, and says nothing changed when it doesn't", async () => {
    const { menu, run } = setup();
    assert.deepEqual(
      await run("menu_detach_modifier_group", { item: "Bạc xỉu", group: "Topping" }),
      ok('"Bạc xỉu" no longer offers "Topping".'),
    );
    assert.deepEqual((await item(menu, "Bạc xỉu")).modifierGroupIds, ["MG-sugar", "MG-ice"]);
    assert.deepEqual(
      await run("menu_detach_modifier_group", { item: "Bạc xỉu", group: "Topping" }),
      ok('"Bạc xỉu" doesn\'t offer "Topping"; nothing changed.'),
    );
  });

  it("menu_add_size adds a priced size", async () => {
    const { menu, run } = setup();
    assert.deepEqual(
      await run("menu_add_size", { item: "Cà phê cốt dừa", name: "M", price: "5.75" }),
      ok('Added the size "Cà phê cốt dừa (M)" at $5.75.'),
    );
    assert.deepEqual(
      (await item(menu, "Cà phê cốt dừa")).variations.map((v) => [v.name, v.price.amount]),
      [
        ["L", 650],
        ["M", 575],
      ],
    );
  });

  it("menu_update_size renames a size and sets its SKU", async () => {
    const { menu, run } = setup();
    assert.deepEqual(
      await run("menu_update_size", { size: "Bạc xỉu (L)", name: "XL", sku: "BX-XL" }),
      ok('Updated "Bạc xỉu (L)" (now "Bạc xỉu (XL)"): name, sku.'),
    );
    assert.deepEqual(
      await run("menu_update_size", { size: "Bạc xỉu (M)", name: "", sku: "BX-M" }),
      ok('Updated "Bạc xỉu (M)": sku.'),
    );
    assert.deepEqual(
      (await item(menu, "Bạc xỉu")).variations.map((v) => [v.name, v.sku]),
      [
        ["M", "BX-M"],
        ["XL", "BX-XL"],
      ],
    );
  });

  it("menu_set_size_price sets one size's price in cents", async () => {
    const { menu, run } = setup();
    assert.deepEqual(
      await run("menu_set_size_price", { size: "Bạc xỉu (L)", price: "$6" }),
      ok('Set "Bạc xỉu (L)" to $6.00 (was $5.50).'),
    );
    const sizes = (await item(menu, "Bạc xỉu")).variations;
    assert.deepEqual(sizes.find((v) => v.name === "L")?.price, { amount: 600, currency: "USD" });
    assert.equal(sizes.find((v) => v.name === "M")?.price.amount, 475);
  });

  it("menu_remove_size removes a size", async () => {
    const { menu, run } = setup();
    assert.deepEqual(
      await run("menu_remove_size", { size: "Bạc xỉu (L)" }),
      ok('Removed the size "Bạc xỉu (L)".'),
    );
    assert.deepEqual((await item(menu, "Bạc xỉu")).variations.map((v) => v.name), ["M"]);
  });

  it("menu_create_category, menu_rename_category and menu_delete_category manage categories", async () => {
    const { menu, run } = setup();
    assert.deepEqual(
      await run("menu_create_category", { name: "Nước ép" }),
      ok('Created the category "Nước ép".'),
    );
    assert.deepEqual(
      await run("menu_rename_category", { category: "nuoc ep", name: "Sinh tố" }),
      ok('Renamed the category "Nước ép" to "Sinh tố".'),
    );
    assert.ok((await menu.listCategories()).some((c) => c.name === "Sinh tố"));
    assert.deepEqual(
      await run("menu_delete_category", { category: "Sinh tố" }),
      ok('Deleted the category "Sinh tố".'),
    );
    assert.deepEqual(
      (await menu.listCategories()).map((c) => c.name),
      ["Cà phê", "Trà", "Đá xay", "Bánh"],
    );
  });

  it("menu_delete_modifier_group deletes a group no item uses", async () => {
    const { menu, run } = setup();
    for (const i of await menu.listItems({ includeArchived: true })) {
      await menu.updateItem(i.id, { modifierGroupIds: i.modifierGroupIds.filter((id) => id !== "MG-topping") });
    }
    assert.deepEqual(
      await run("menu_delete_modifier_group", { group: "Topping" }),
      ok('Deleted the modifier group "Topping".'),
    );
    assert.deepEqual(
      (await menu.listModifierGroups()).map((g) => g.id),
      ["MG-sugar", "MG-ice"],
    );
  });
});

describe("menu actions: refusals", () => {
  it("ask for a choice when a required dropdown is empty, without calling the menu", async () => {
    const cases: [string, Record<string, string | boolean>, string][] = [
      ["menu_update_item", { item: "", name: "X" }, "Choose an item first."],
      ["menu_set_item_archived", { item: "", archived: true }, "Choose an item first."],
      ["menu_set_item_image", { item: "", image_url: "" }, "Choose an item first."],
      ["menu_attach_modifier_group", { item: "Bạc xỉu", group: "" }, "Choose a modifier group first."],
      ["menu_detach_modifier_group", { item: "", group: "Topping" }, "Choose an item first."],
      ["menu_add_size", { item: "", name: "XL", price: "6" }, "Choose an item first."],
      ["menu_update_size", { size: "", name: "XL" }, "Choose a size first."],
      ["menu_set_size_price", { size: "", price: "6" }, "Choose a size first."],
      ["menu_remove_size", { size: "" }, "Choose a size first."],
      ["menu_rename_category", { category: "", name: "X" }, "Choose a category first."],
      ["menu_delete_category", { category: "" }, "Choose a category first."],
      ["menu_delete_modifier_group", { group: "" }, "Choose a modifier group first."],
    ];
    for (const [action, values, message] of cases) {
      const { menu, calls } = spied(createInMemoryPosMenu());
      assert.deepEqual(await setup(menu).run(action, values), refused(message), action);
      assert.deepEqual(calls, [], action);
    }
  });

  it("answer a name that no longer matches with a way forward", async () => {
    const { run } = setup();
    assert.deepEqual(
      await run("menu_update_item", { item: "Phở", description: "Soup" }),
      refused('No item named "Phở". Ask the agent to show the form again.'),
    );
    assert.deepEqual(
      await run("menu_set_size_price", { size: "Bạc xỉu (XL)", price: "6" }),
      refused('No size named "Bạc xỉu (XL)". Ask the agent to show the form again.'),
    );
    assert.deepEqual(
      await run("menu_create_item", { name: "Phở", size: "M", price: "9", category: "Soup" }),
      refused('No category named "Soup". Ask the agent to show the form again.'),
    );
    assert.deepEqual(
      await run("menu_attach_modifier_group", { item: "Bạc xỉu", group: "Size" }),
      refused('No modifier group named "Size". Ask the agent to show the form again.'),
    );
  });

  it("answer an ambiguous name with every match", async () => {
    const { menu, run } = setup();
    await menu.createItem({ name: "Bac Xiu", variations: [{ name: "L", price: { amount: 500, currency: "USD" } }] });
    assert.deepEqual(
      await run("menu_set_size_price", { size: "bac xiu (l)", price: "6" }),
      refused(
        '"bac xiu (l)" matches 2 sizes ("Bạc xỉu (L)", "Bac Xiu (L)"). Rename one so they differ, then try again.',
      ),
    );
  });

  it("refuse a price that doesn't look like one, without calling the menu", async () => {
    const cases: [string, Record<string, string>][] = [
      ["menu_create_item", { name: "Phở", size: "M", price: "nine" }],
      ["menu_add_size", { item: "Bạc xỉu", name: "XL", price: "6.999" }],
      ["menu_set_size_price", { size: "Bạc xỉu (L)", price: "" }],
    ];
    for (const [action, values] of cases) {
      const { menu, calls } = spied(createInMemoryPosMenu());
      assert.deepEqual(await setup(menu).run(action, values), refused("Price must look like 4.50."), action);
      assert.deepEqual(calls, [], action);
    }
  });

  it("refuse an update with nothing to change, without calling the menu", async () => {
    for (const [action, values] of [
      ["menu_update_item", { item: "Bạc xỉu", name: "", description: " ", category: "" }],
      ["menu_update_item", { item: "Bạc xỉu" }],
      ["menu_update_size", { size: "Bạc xỉu (L)", name: "", sku: "" }],
    ] as const) {
      const { menu, calls } = spied(createInMemoryPosMenu());
      assert.deepEqual(
        await setup(menu).run(action, values),
        refused("Nothing to change: fill in at least one field."),
        action,
      );
      assert.deepEqual(calls, [], action);
    }
  });

  it("pass on the menu's reason for a refused change", async () => {
    const { menu, run } = setup();
    assert.deepEqual(
      await run("menu_delete_category", { category: "Cà phê" }),
      refused(
        "3 items use this category (Cà phê sữa đá, Cà phê đen đá, Bạc xỉu). Move them to another category first.",
      ),
    );
    assert.deepEqual(
      await run("menu_remove_size", { size: "Cà phê cốt dừa (L)" }),
      refused("An item must keep at least one variation"),
    );
    assert.deepEqual(
      await run("menu_set_item_image", { item: "Bạc xỉu", image_url: "ftp://example.com/bx.jpg" }),
      refused("Image must be an http or https URL"),
    );
    assert.deepEqual(
      await run("menu_rename_category", { category: "Trà", name: "Cà phê" }),
      refused('A category named "Cà phê" already exists.'),
    );
    assert.equal((await menu.listCategories()).length, 4);
    assert.equal((await item(menu, "Cà phê cốt dừa")).variations.length, 1);
  });

  it("let any other error through, so the registry answers that the action failed and logs it", async () => {
    const menu: PosMenu = {
      ...createInMemoryPosMenu(),
      listCategories: async () => {
        throw new Error("connection reset");
      },
    };
    const { run, errors } = setup(menu);
    assert.deepEqual(
      await run("menu_rename_category", { category: "Trà", name: "Tea" }),
      refused("That action failed."),
    );
    assert.equal(errors.length, 1);
  });
});

describe("menu actions: a generated edit-item form", () => {
  it("passes validateUiTree with the menu specs, and a click on it passes checkActionRequest", async () => {
    const { registry, run } = setup();
    const tree: UiNode = {
      component: "Stack",
      children: [
        {
          component: "Select",
          props: { label: "Item", name: "item", options: await registry.listChoices(ITEMS, signal) },
        },
        { component: "TextInput", props: { label: "Name", name: "name" } },
        { component: "TextInput", props: { label: "Description", name: "description" } },
        {
          component: "Select",
          props: { label: "Category", name: "category", options: await registry.listChoices(CATEGORIES, signal) },
        },
        { component: "Button", props: { label: "Save", action: "menu_update_item" } },
      ],
    };
    const components = await new InMemoryComponentRepository(catalog).list();
    assert.deepEqual(validateUiTree(tree, components, registry.specs).errors, []);

    const values = { item: "Bạc xỉu", name: "", description: "Sweeter", category: "" };
    assert.deepEqual(checkActionRequest(tree, "menu_update_item", values), { ok: true });
    assert.deepEqual(await run("menu_update_item", values), ok('Updated "Bạc xỉu": description.'));
  });
});
