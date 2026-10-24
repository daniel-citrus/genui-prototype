import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UiNode } from "shared/ui";
import { createActions } from "../../actions/index";
import { createMenuActions } from "../../actions/menu/index";
import { createActionRegistry } from "../../actions/registry";
import { items } from "../../adapters/pos/fixtures";
import { createInMemoryPosMenu } from "../../adapters/pos/InMemoryPosMenu";
import { catalog } from "../../catalog/components";
import { InMemoryComponentRepository } from "../../ports/fakes/InMemoryComponentRepository";
import { createToolRegistry, MAX_RESULT_DATA_CHARS } from "../registry";
import type { ToolContext } from "../tools";
import { createAgentTools } from "./index";

/** The tools as `server/index.ts` builds them, over the demo menu. */
function setup() {
  const actions = createActionRegistry([...createActions(), ...createMenuActions(createInMemoryPosMenu())]);
  const tools = createToolRegistry(
    createAgentTools({
      components: new InMemoryComponentRepository(catalog),
      actions: actions.specs,
      listChoices: actions.listChoices,
    }),
  );
  const shown: UiNode[] = [];
  const ctx: ToolContext = {
    signal: new AbortController().signal,
    log: { info() {}, debug() {}, error() {}, warn() {} },
    showUi: (tree) => void shown.push(tree),
  };
  return { actions, tools, ctx, shown };
}

interface Listed {
  match: string;
  actions: { name: string }[];
  others: { name: string }[];
  choices: Record<string, { values: string[]; truncated: boolean }>;
}

async function list(area: string, operation: string) {
  const { tools, ctx } = setup();
  const result = await tools.run("list_actions", { area, operation }, ctx);
  assert.equal(result.ok, true);
  return result.data as Listed;
}

describe("list_actions with the menu actions", () => {
  const cases: [string, string, "exact" | "area", string[]][] = [
    ["items", "edit", "exact", ["menu_update_item", "menu_set_item_image"]],
    ["categories", "delete", "exact", ["menu_delete_category"]],
    ["prices", "edit", "exact", ["menu_set_size_price"]],
    ["items", "archive", "exact", ["menu_set_item_archived"]],
    [
      "items",
      "delete",
      "area",
      ["menu_create_item", "menu_update_item", "menu_set_item_archived", "menu_set_item_image"],
    ],
  ];
  for (const [area, operation, match, names] of cases) {
    it(`finds ${names.join(", ")} for ${area} + ${operation}`, async () => {
      const data = await list(area, operation);
      assert.equal(data.match, match);
      assert.deepEqual(data.actions.map((a) => a.name), names);
    });
  }

  it("lists every demo item, archived too, and the categories, sorted by folded name", async () => {
    const { choices } = await list("items", "edit");
    assert.deepEqual(Object.keys(choices).toSorted(), ["menu_categories", "menu_items"]);
    assert.deepEqual(choices.menu_items, {
      values: [
        "Bạc xỉu",
        "Bánh mì thịt",
        "Cà phê cốt dừa",
        "Cà phê đen đá",
        "Cà phê sữa đá",
        "Chè ba màu",
        "Trà đào cam sả",
      ],
      truncated: false,
    });
    assert.deepEqual(choices.menu_items.values.toSorted(), items.map((i) => i.name).toSorted());
    assert.deepEqual(choices.menu_categories, { values: ["Bánh", "Cà phê", "Đá xay", "Trà"], truncated: false });
  });

  it("returns any + any in full: the first 10 actions, the other 5 in others, under the size cap", async () => {
    const { actions, tools, ctx } = setup();
    const result = await tools.run("list_actions", { area: "any", operation: "any" }, ctx);
    const data = result.data as Listed;
    const names = actions.specs.map((spec) => spec.name);

    assert.equal(names.length, 15);
    assert.equal(data.match, "exact");
    assert.deepEqual(data.actions.map((a) => a.name), names.slice(0, 10));
    assert.deepEqual(data.others.map((a) => a.name), names.slice(10));
    assert.deepEqual(Object.keys(data.choices).toSorted(), [
      "menu_categories",
      "menu_item_sizes",
      "menu_items",
      "menu_modifier_groups",
    ]);
    assert.ok(JSON.stringify(data).length < MAX_RESULT_DATA_CHARS);
  });
});
