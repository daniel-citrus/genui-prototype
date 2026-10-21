import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInMemoryPosMenu } from "../../adapters/pos/InMemoryPosMenu";
import type { PosMenu } from "../../ports/PosMenu";
import { chosen, findCategory, findGroup, findItem, findSize, text } from "./resolve";

const usd = (amount: number) => ({ amount, currency: "USD" });

/** A `PosMenuError` carrying exactly `message`, for `assert.throws` and `assert.rejects`. */
const refusal = (message: string) => ({ name: "PosMenuError", message });
const notFound = (kind: string, name: string) =>
  refusal(`No ${kind} named "${name}". Ask the agent to show the form again.`);
const ambiguous = (name: string, matches: string) =>
  refusal(`"${name}" matches ${matches}. Rename one so they differ, then try again.`);

/** The demo menu plus a second "Bac Xiu" item, so "bac xiu" folds to two names. */
async function menuWithLookalike(): Promise<PosMenu> {
  const menu = createInMemoryPosMenu();
  await menu.createItem({ name: "Bac Xiu", variations: [{ name: "L", price: usd(500) }] });
  return menu;
}

describe("text", () => {
  it("trims text and treats a missing or boolean value as empty", () => {
    assert.equal(text({ a: "  hi " }, "a"), "hi");
    assert.equal(text({}, "a"), "");
    assert.equal(text({ a: true }, "a"), "");
  });
});

describe("chosen", () => {
  it("returns the trimmed value", () => {
    assert.equal(chosen({ item: " Bạc xỉu " }, "item"), "Bạc xỉu");
  });

  it("asks for a choice when the value is empty, blank or missing", () => {
    assert.throws(() => chosen({ item: "" }, "item"), refusal("Choose an item first."));
    assert.throws(() => chosen({ size: "  " }, "size"), refusal("Choose a size first."));
    assert.throws(() => chosen({}, "category"), refusal("Choose a category first."));
    assert.throws(() => chosen({ group: "" }, "group"), refusal("Choose a modifier group first."));
  });
});

describe("findItem", () => {
  it("finds an item by exact name, archived ones too", async () => {
    const menu = createInMemoryPosMenu();
    assert.equal((await findItem(menu, "Bạc xỉu")).id, "ITEM-bac-xiu");
    assert.equal((await findItem(menu, "Chè ba màu")).id, "ITEM-che-ba-mau");
  });

  it("finds an item by its folded name: accents, case and punctuation ignored", async () => {
    const menu = createInMemoryPosMenu();
    assert.equal((await findItem(menu, "bac xiu")).id, "ITEM-bac-xiu");
    assert.equal((await findItem(menu, "CA-PHE sua da!")).id, "ITEM-cf-sua-da");
  });

  it("answers a missing name with a way forward", async () => {
    await assert.rejects(
      findItem(createInMemoryPosMenu(), "Trà sữa"),
      notFound("item", "Trà sữa"),
    );
  });

  it("prefers the exact name over several folded matches", async () => {
    const menu = await menuWithLookalike();
    assert.equal((await findItem(menu, "Bạc xỉu")).id, "ITEM-bac-xiu");
    assert.equal((await findItem(menu, "Bac Xiu")).name, "Bac Xiu");
  });

  it("lists every match when a folded name is ambiguous", async () => {
    await assert.rejects(
      findItem(await menuWithLookalike(), "bac xiu"),
      ambiguous("bac xiu", '2 items ("Bạc xỉu", "Bac Xiu")'),
    );
  });

  it("treats two items with the same exact name as ambiguous", async () => {
    const menu = createInMemoryPosMenu();
    await menu.createItem({ name: "Bạc xỉu", variations: [{ name: "M", price: usd(500) }] });
    await assert.rejects(
      findItem(menu, "Bạc xỉu"),
      ambiguous("Bạc xỉu", '2 items ("Bạc xỉu", "Bạc xỉu")'),
    );
  });
});

describe("findSize", () => {
  it("finds a size by its exact or folded Item (Size) label", async () => {
    const menu = createInMemoryPosMenu();
    for (const label of ["Bạc xỉu (L)", "bac xiu (l)", "bac xiu l"]) {
      const found = await findSize(menu, label);
      assert.equal(found.item.id, "ITEM-bac-xiu", label);
      assert.equal(found.size.id, "VAR-bac-xiu-L", label);
      assert.equal(found.label, "Bạc xỉu (L)", label);
    }
  });

  it("answers a missing label", async () => {
    await assert.rejects(
      findSize(createInMemoryPosMenu(), "Bạc xỉu (XL)"),
      notFound("size", "Bạc xỉu (XL)"),
    );
  });

  it("lists every match when a folded label is ambiguous", async () => {
    await assert.rejects(
      findSize(await menuWithLookalike(), "bac xiu (l)"),
      ambiguous("bac xiu (l)", '2 sizes ("Bạc xỉu (L)", "Bac Xiu (L)")'),
    );
  });
});

describe("findCategory and findGroup", () => {
  it("find by exact or folded name", async () => {
    const menu = createInMemoryPosMenu();
    assert.equal((await findCategory(menu, "Cà phê")).id, "CAT-coffee");
    assert.equal((await findCategory(menu, "da xay")).id, "CAT-blended");
    assert.equal((await findGroup(menu, "Mức đá (Ice level)")).id, "MG-ice");
    assert.equal((await findGroup(menu, "topping")).id, "MG-topping");
  });

  it("answer a missing name", async () => {
    const menu = createInMemoryPosMenu();
    await assert.rejects(findCategory(menu, "Nước"), notFound("category", "Nước"));
    await assert.rejects(findGroup(menu, "Size"), notFound("modifier group", "Size"));
  });

  it("list every match when a folded name is ambiguous", async () => {
    const menu: PosMenu = {
      ...createInMemoryPosMenu(),
      listCategories: async () => [
        { id: "a", name: "Trà" },
        { id: "b", name: "Tra" },
      ],
    };
    assert.equal((await findCategory(menu, "Tra")).id, "b");
    await assert.rejects(
      findCategory(menu, "tra"),
      ambiguous("tra", '2 categories ("Trà", "Tra")'),
    );
  });

  it("never matches a name that folds to nothing by its folded form", async () => {
    const menu: PosMenu = { ...createInMemoryPosMenu(), listCategories: async () => [{ id: "a", name: "!!" }] };
    await assert.rejects(findCategory(menu, "?"), notFound("category", "?"));
  });
});
