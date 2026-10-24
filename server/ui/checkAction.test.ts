import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_FIELD_CHARS } from "shared/api";
import type { UiNode } from "shared/ui";
import { checkActionRequest } from "./checkAction";

const design: UiNode = {
  component: "Card",
  children: [
    { component: "TextInput", props: { label: "Name", name: "name" } },
    { component: "TextInput", props: { label: "Code", name: "code", type: "password" } },
    { component: "Checkbox", props: { label: "Updates", name: "updates" } },
    { component: "Select", props: { label: "Plan", name: "plan", options: ["Free", "Pro"] } },
    { component: "Button", props: { label: "Go", action: "sign_up" } },
    { component: "Button", props: { label: "Later", action: "remind_me", disabled: true } },
  ],
};

const refused = (action: string, values: Record<string, string | boolean>) => {
  const check = checkActionRequest(design, action, values);
  assert.equal(check.ok, false);
  return check.ok ? "" : check.message;
};

describe("checkActionRequest", () => {
  it("accepts an enabled Button's action with values that fit their inputs", () => {
    assert.deepEqual(checkActionRequest(design, "sign_up", {}), { ok: true });
    assert.deepEqual(
      checkActionRequest(design, "sign_up", {
        name: "x".repeat(MAX_FIELD_CHARS),
        updates: false,
        plan: "Pro",
      }),
      { ok: true },
    );
    assert.deepEqual(checkActionRequest(design, "sign_up", { plan: "" }), { ok: true });
  });

  it("refuses an action that no Button in the design names", () => {
    assert.match(refused("delete_all", {}), /no enabled button/);
  });

  it("refuses the action of a disabled Button", () => {
    assert.match(refused("remind_me", {}), /no enabled button/);
  });

  it("refuses a key that isn't the name of an input", () => {
    assert.match(refused("sign_up", { email: "a@b.c" }), /no input named "email"/);
  });

  it("refuses any value for a password field, without echoing it", () => {
    const message = refused("sign_up", { code: "hunter2" });
    assert.match(message, /password/);
    assert.ok(!message.includes("hunter2"));
  });

  it("refuses a TextInput value that is not a string or is too long", () => {
    refused("sign_up", { name: true });
    refused("sign_up", { name: "x".repeat(MAX_FIELD_CHARS + 1) });
  });

  it("refuses a Checkbox value that is not a boolean", () => {
    refused("sign_up", { updates: "true" });
  });

  it("refuses a Select value that is neither empty nor an option", () => {
    refused("sign_up", { plan: "Enterprise" });
    refused("sign_up", { plan: true });
  });

  it("accepts a shared name when the value fits any input with it, unless one is a password", () => {
    const shared: UiNode = {
      component: "Stack",
      children: [
        { component: "Checkbox", props: { label: "A", name: "pick" } },
        { component: "Select", props: { label: "B", name: "pick", options: ["x"] } },
        { component: "TextInput", props: { label: "C", name: "secret" } },
        { component: "TextInput", props: { label: "D", name: "secret", type: "password" } },
        { component: "Button", props: { label: "Go", action: "go" } },
      ],
    };
    assert.deepEqual(checkActionRequest(shared, "go", { pick: true }), { ok: true });
    assert.deepEqual(checkActionRequest(shared, "go", { pick: "x" }), { ok: true });
    assert.equal(checkActionRequest(shared, "go", { pick: "y" }).ok, false);
    assert.equal(checkActionRequest(shared, "go", { secret: "s" }).ok, false);
  });

  describe("with Markup", () => {
    const withMarkup: UiNode = {
      component: "Stack",
      children: [
        { component: "TextInput", props: { label: "Email", name: "email" } },
        {
          component: "Markup",
          props: {
            root: {
              tag: "div",
              children: [
                { tag: "input", attrs: { name: "qty", type: "number" } },
                { tag: "input", attrs: { name: "gift", type: "checkbox" } },
                {
                  tag: "select",
                  attrs: { name: "size" },
                  children: [
                    { tag: "option", attrs: { value: "s" }, text: "Small" },
                    { tag: "option", text: "Large" },
                  ],
                },
                { tag: "button", action: "order", text: "Order" },
                { tag: "button", action: "cancel", attrs: { disabled: true }, text: "Cancel" },
              ],
            },
          },
        },
      ],
    };

    it("accepts an enabled Markup button's action with values that fit its inputs", () => {
      assert.deepEqual(
        checkActionRequest(withMarkup, "order", { email: "a@b.c", qty: "2", gift: true, size: "Large" }),
        { ok: true },
      );
      assert.deepEqual(checkActionRequest(withMarkup, "order", { size: "s" }), { ok: true });
    });

    it("refuses a disabled Markup button and values that don't fit or have no input", () => {
      const message = (action: string, values: Record<string, string | boolean>) => {
        const check = checkActionRequest(withMarkup, action, values);
        return check.ok ? "" : check.message;
      };
      assert.match(message("cancel", {}), /no enabled button/);
      assert.match(message("order", { note: "x" }), /no input named "note"/);
      assert.match(message("order", { size: "Small" }), /doesn't fit/);
      assert.match(message("order", { gift: "yes" }), /doesn't fit/);
    });
  });
});

describe("checkActionRequest with Cards", () => {
  const card = () => ({
    component: "Card",
    children: [
      { component: "Select", props: { label: "Item", name: "item", options: ["A", "B"] } },
      { component: "TextInput", props: { label: "Name", name: "name" } },
      { component: "Button", props: { label: "Save", action: "menu_update_item" } },
    ],
  });
  const lone = { component: "TextInput", props: { label: "Other", name: "other" } };
  const cards: UiNode = { component: "Stack", children: [card(), card(), lone] };
  const msg = (values: Record<string, string | boolean>, tree: UiNode = cards) => {
    const check = checkActionRequest(tree, "menu_update_item", values);
    return check.ok ? "" : check.message;
  };

  it("accepts values from one Card, whichever Card", () => {
    assert.deepEqual(checkActionRequest(cards, "menu_update_item", { item: "B", name: "x" }), { ok: true });
  });

  it("refuses a name that no scope of the action has", () => {
    assert.equal(msg({ other: "x" }), 'This design has no input named "other" next to a "menu_update_item" button.');
  });

  it("refuses values from inputs found only in different Cards", () => {
    const tree: UiNode = {
      component: "Stack",
      children: [
        { component: "Card", children: [{ component: "TextInput", props: { label: "A", name: "a" } }, card().children[2]] },
        { component: "Card", children: [{ component: "TextInput", props: { label: "B", name: "b" } }, card().children[2]] },
      ],
    };
    assert.deepEqual(checkActionRequest(tree, "menu_update_item", { a: "1" }), { ok: true });
    assert.equal(msg({ a: "1", b: "2" }, tree), 'This design has no input named "b" next to a "menu_update_item" button.');
  });

  it("still checks that a value fits its input", () => {
    assert.equal(msg({ item: "Z" }), 'The value for "item" doesn\'t fit its input.');
  });

  it("keeps the old message when the button is outside every Card", () => {
    const tree: UiNode = { component: "Stack", children: [lone, { component: "Button", props: { label: "Go", action: "menu_update_item" } }] };
    assert.deepEqual(checkActionRequest(tree, "menu_update_item", { other: "x" }), { ok: true });
    assert.equal(msg({ nope: "x" }, tree), 'This design has no input named "nope".');
  });
});
