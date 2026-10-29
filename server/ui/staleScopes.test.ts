import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActionSpec } from "../actions/types";
import { staleScopes } from "./staleScopes";

const spec = (name: string, choices?: Record<string, string>): ActionSpec => ({
  name,
  description: "",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
  ...(choices && { choices }),
});

const specs = [
  spec("update_item", { item: "items" }),
  spec("rename_category", { category: "categories" }),
  spec("create_category"),
];

const select = (name: string, options: string[], extra: Record<string, unknown> = {}) => ({
  component: "Select",
  props: { label: name, name, options, ...extra },
});
const button = (action: string, disabled = false) => ({ component: "Button", props: { label: action, action, disabled } });
const card = (...children: unknown[]) => ({ component: "Card", children });
const stack = (...children: unknown[]) => ({ component: "Stack", children });

/** A lister over fixed values that records each source it was asked for. */
function lister(values: Record<string, string[]>) {
  const calls: string[] = [];
  const list = async (source: string) => {
    calls.push(source);
    const found = values[source];
    if (!found) throw new Error(`no ${source}`);
    return found;
  };
  return { list, calls };
}

describe("staleScopes", () => {
  it("checks a disabled Select's preset only, and an enabled one's every non-empty option", async () => {
    const tree = stack(
      card(select("item", ["Tea", "Coffee"], { value: "Tea", disabled: true }), button("update_item")),
      card(select("item", ["Tea", "Coffee"], { value: "Coffee", disabled: true }), button("update_item")),
      card(select("item", ["", "Coffee"]), button("update_item")),
      card(select("item", ["Coffee", "Tea"]), button("update_item")),
    );
    const { list } = lister({ items: ["Coffee", "Juice"] });
    assert.deepEqual(await staleScopes(tree, specs, list), ["tree.children.0", "tree.children.3"]);
  });

  it("counts a disabled Select without a preset by its options", async () => {
    const tree = card(select("item", ["Tea"], { disabled: true }), button("update_item"));
    assert.deepEqual(await staleScopes(tree, specs, lister({ items: ["Coffee"] }).list), ["tree"]);
  });

  it("counts every option of a Markup select, whatever it starts on", async () => {
    const root = {
      tag: "div",
      children: [
        {
          tag: "select",
          attrs: { name: "category", disabled: true },
          children: [
            { tag: "option", attrs: { value: "Tea", selected: true } },
            { tag: "option", text: "Snacks" },
          ],
        },
        { tag: "button", action: "rename_category", text: "Rename" },
      ],
    };
    const tree = stack(card({ component: "Markup", props: { root } }));
    assert.deepEqual(await staleScopes(tree, specs, lister({ categories: ["Tea"] }).list), ["tree.children.0"]);
    assert.deepEqual(await staleScopes(tree, specs, lister({ categories: ["Snacks", "Tea"] }).list), []);
  });

  it('names a Select outside every Card "tree", once', async () => {
    const tree = stack(select("item", ["Tea"]), select("category", ["Tea"]), button("update_item"), button("rename_category"));
    assert.deepEqual(await staleScopes(tree, specs, lister({ items: [], categories: [] }).list), ["tree"]);
  });

  it("skips Selects no enabled button binds to a source", async () => {
    const tree = stack(
      card(select("item", ["Tea"]), button("update_item", true)),
      card(select("item", ["Tea"]), button("create_category")),
      card(select("other", ["Tea"]), button("update_item")),
      card(select("item", ["Tea"])),
      card({ component: "TextInput", props: { label: "Item", name: "item" } }, button("update_item")),
      card(select("item", ["Tea"]), button("unknown_action")),
    );
    const { list, calls } = lister({ items: [] });
    assert.deepEqual(await staleScopes(tree, specs, list), []);
    assert.deepEqual(calls, []);
  });

  it("binds a Select only to buttons that send it", async () => {
    const tree = stack(card(select("item", ["Tea"])), card(button("update_item")));
    assert.deepEqual(await staleScopes(tree, specs, lister({ items: [] }).list), []);
  });

  it("lists each bound source once", async () => {
    const tree = stack(
      card(select("item", ["Tea"], { value: "Tea", disabled: true }), button("update_item")),
      card(select("item", ["Coffee"], { value: "Coffee", disabled: true }), button("update_item"), button("update_item")),
      card(select("category", ["Snacks"]), button("rename_category")),
    );
    const { list, calls } = lister({ items: ["Tea", "Coffee"], categories: ["Snacks"] });
    assert.deepEqual(await staleScopes(tree, specs, list), []);
    assert.deepEqual(calls.sort(), ["categories", "items"]);
  });

  it("counts every scope bound to a source that fails to list as stale", async () => {
    const tree = stack(
      card(select("item", ["Tea"], { value: "Tea", disabled: true }), button("update_item")),
      card(select("category", ["Snacks"]), button("rename_category")),
      card(select("item", ["Coffee"], { value: "Coffee", disabled: true }), button("update_item")),
    );
    const { list } = lister({ categories: ["Snacks"] });
    assert.deepEqual(await staleScopes(tree, specs, list), ["tree.children.0", "tree.children.2"]);
  });
});
