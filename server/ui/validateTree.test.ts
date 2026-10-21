import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Component } from "shared/components";
import type { ActionSpec } from "../actions/types";
import { catalog } from "../catalog/components";
import { InMemoryComponentRepository } from "../ports/fakes/InMemoryComponentRepository";
import { validateUiTree, validatorCompileCount } from "./validateTree";

const repo = new InMemoryComponentRepository(catalog);
const stored = () => repo.list();

async function check(tree: unknown, actions?: ActionSpec[], choiceValues?: Record<string, string[]>) {
  return validateUiTree(tree, await stored(), actions, choiceValues);
}

const button = { component: "Button", props: { label: "Go" } };

describe("validateUiTree", () => {
  it("accepts a valid tree and counts nodes, depth and components", async () => {
    const result = await check({
      component: "Stack",
      children: [button, { component: "Card", children: [button] }],
    });
    assert.deepEqual(result, {
      ok: true,
      errors: [],
      stats: { nodes: 4, depth: 3, components: { Stack: 1, Button: 2, Card: 1 } },
    });
  });

  it("accepts every catalog component's example props as children of a Stack", async () => {
    const tree = {
      component: "Stack",
      children: catalog
        .filter((c) => c.name !== "Stack")
        .map((c) => ({ component: c.name, props: c.exampleProps })),
    };
    const result = await check(tree);
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
  });

  it("reports malformed nodes", async () => {
    const result = await check({
      component: "Stack",
      children: [button, 7, { props: {} }, { component: "Divider", extra: 1 }, { component: "Divider", props: [] }],
    });
    assert.deepEqual(result.errors, [
      'tree.children.1 must be an object with a "component" string',
      'tree.children.2 must be an object with a "component" string',
      "tree.children.3.extra is not allowed (use component, props, children)",
      "tree.children.4.props must be an object",
    ]);
  });

  it("rejects a non-array children and a non-object tree", async () => {
    assert.deepEqual((await check({ component: "Stack", children: {} })).errors, [
      "tree.children must be an array",
    ]);
    assert.deepEqual((await check("hi")).errors, ['tree must be an object with a "component" string']);
  });

  it("rejects unknown components and suggests the right case", async () => {
    const result = await check({
      component: "Stack",
      children: [{ component: "button", props: { label: "x" } }, { component: "Carousel" }],
    });
    assert.deepEqual(result.errors, [
      'tree.children.0.component "button" is not in the catalog (did you mean Button?)',
      'tree.children.1.component "Carousel" is not in the catalog',
    ]);
  });

  it("reports props that break the schema", async () => {
    const result = await check({
      component: "Stack",
      children: [
        { component: "Button" },
        { component: "Button", props: { label: 3 } },
        { component: "Button", props: { label: "x", variant: "huge" } },
        { component: "Button", props: { label: "x", color: "red" } },
      ],
    });
    assert.deepEqual(result.errors, [
      "tree.children.0.props.label is required",
      "tree.children.1.props.label must be string",
      "tree.children.2.props.variant must be one of primary, secondary, danger",
      "tree.children.3.props.color is not allowed",
    ]);
  });

  it("rejects children on a component that takes none", async () => {
    const result = await check({ component: "Stack", children: [{ ...button, children: [button] }] });
    assert.deepEqual(result.errors, ["tree.children.0 Button cannot have children"]);
  });

  it("limits depth to 8 levels and nodes to 100", async () => {
    let deep: unknown = { component: "Divider" };
    for (let i = 0; i < 8; i++) deep = { component: "Stack", children: [deep] };
    assert.deepEqual((await check(deep)).errors, ["tree is 9 levels deep (max 8)"]);

    let ok: unknown = { component: "Divider" };
    for (let i = 0; i < 7; i++) ok = { component: "Stack", children: [ok] };
    assert.equal((await check(ok)).ok, true);

    const wide = { component: "Stack", children: Array.from({ length: 139 }, () => ({ component: "Divider" })) };
    assert.deepEqual((await check(wide)).errors, ["tree has 140 nodes (max 100)"]);
  });

  it("reports several problems in one call", async () => {
    const result = await check({
      component: "Stack",
      children: [{ component: "nope" }, { component: "Button" }, { component: "Divider", children: [] }],
    });
    assert.equal(result.errors.length, 3);
    assert.equal(result.ok, false);
  });

  it("returns exactly 20 entries when there are more problems, the last counting the rest", async () => {
    const result = await check({
      component: "Stack",
      children: Array.from({ length: 30 }, () => ({ component: "Nope" })),
    });
    assert.equal(result.errors.length, 20);
    assert.equal(result.errors[19], "…and 11 more");
    assert.equal(result.errors[0], 'tree.children.0.component "Nope" is not in the catalog');
  });

  it("compiles each component's validator once per updatedAt", async () => {
    const tree = { component: "Stack", children: [button, { component: "Badge", props: { text: "x" } }] };
    await check(tree); // warm the cache
    const before = validatorCompileCount();
    for (let i = 0; i < 3; i++) await check(tree);
    assert.equal(validatorCompileCount(), before);

    const bumped: Component[] = (await stored()).map((c) =>
      c.name === "Button" ? { ...c, updatedAt: "2099-01-01T00:00:00.000Z" } : c,
    );
    validateUiTree(tree, bumped);
    assert.equal(validatorCompileCount(), before + 1);
    validateUiTree(tree, bumped);
    assert.equal(validatorCompileCount(), before + 1);
  });

  it("accepts only http(s) image URLs", async () => {
    const image = (src: string) => check({ component: "Image", props: { src, alt: "x" } });
    assert.equal((await image("https://example.com/a.png")).ok, true);
    assert.equal((await image("http://example.com/a.png")).ok, true);
    for (const src of ["javascript:alert(1)", "data:image/png;base64,AAAA"]) {
      const result = await image(src);
      assert.equal(result.ok, false, src);
      assert.match(result.errors[0], /^tree\.props\.src /);
    }
  });
});

const signUp: ActionSpec = {
  name: "sign_up",
  description: "Sign someone up.",
  input_schema: {
    type: "object",
    properties: {
      email: { type: "string", description: "Their email." },
      plan: { type: "string", description: "The plan." },
      updates: { type: "boolean", description: "Whether to send updates." },
    },
    required: ["email"],
    additionalProperties: false,
  },
};
const actions = [signUp];

const form = (...children: unknown[]) => ({ component: "Stack", children });
const email = { component: "TextInput", props: { label: "Email", name: "email" } };
const submit = { component: "Button", props: { label: "Sign up", action: "sign_up" } };

describe("validateUiTree bindings", () => {
  it("accepts action and name props wired to a registered action", async () => {
    const tree = form(
      email,
      { component: "Select", props: { label: "Plan", options: ["Free", "Pro"], name: "plan" } },
      { component: "Checkbox", props: { label: "Updates", name: "updates" } },
      { component: "TextInput", props: { label: "Note", name: "note" } },
      submit,
    );
    assert.deepEqual((await check(tree, actions)).errors, []);
    assert.deepEqual((await check(tree)).errors, []);
  });

  it("refuses action and name values that break their patterns", async () => {
    const result = await check(
      form(
        { component: "Button", props: { label: "Go", action: "Sign-Up" } },
        { component: "Button", props: { label: "Go", action: "a".repeat(65) } },
        { component: "TextInput", props: { label: "Email", name: "1email" } },
        { component: "Checkbox", props: { label: "Ok", name: "has space" } },
        { component: "Select", props: { label: "Plan", options: ["A"], name: "b".repeat(65) } },
      ),
    );
    assert.equal(result.errors.length, 5);
    assert.match(result.errors[0], /^tree\.children\.0\.props\.action must match pattern/);
    assert.match(result.errors[1], /^tree\.children\.1\.props\.action must NOT have more than 64 characters/);
    assert.match(result.errors[2], /^tree\.children\.2\.props\.name must match pattern/);
    assert.match(result.errors[3], /^tree\.children\.3\.props\.name must match pattern/);
    assert.match(result.errors[4], /^tree\.children\.4\.props\.name must NOT have more than 64 characters/);
  });

  it("refuses two inputs with the same name, naming both paths, with or without actions", async () => {
    const tree = form(email, {
      component: "Card",
      children: [{ component: "Checkbox", props: { label: "Again", name: "email" } }],
    });
    const expected = 'tree.children.1.children.0.props.name "email" is already used by tree.children.0';
    assert.deepEqual((await check(tree)).errors, [expected]);
    assert.ok((await check(tree, actions)).errors.includes(expected));
  });

  it("refuses an unregistered action and suggests list_actions", async () => {
    const result = await check(
      form(email, { component: "Button", props: { label: "Go", action: "sign_in" } }),
      actions,
    );
    assert.deepEqual(result.errors, [
      'tree.children.1.props.action "sign_in" is not a registered action (call list_actions to see them)',
    ]);
  });

  it("refuses an action whose required property no input fills", async () => {
    const result = await check(form(submit), actions);
    assert.deepEqual(result.errors, [
      'tree.children.0 action "sign_up" needs an input named "email", and none has that name',
    ]);
  });

  it("skips the required check for a disabled Button but still checks its action", async () => {
    const disabled = (action: string) => ({
      component: "Button",
      props: { label: "Soon", action, disabled: true },
    });
    assert.deepEqual((await check(form(disabled("sign_up")), actions)).errors, []);
    assert.equal((await check(form(disabled("nope")), actions)).ok, false);
    // One enabled Button for the action is enough to need its inputs.
    const both = await check(form(disabled("sign_up"), submit), actions);
    assert.deepEqual(both.errors, [
      'tree.children.1 action "sign_up" needs an input named "email", and none has that name',
    ]);
  });

  it("refuses an input of the wrong kind for the property it fills", async () => {
    const result = await check(
      form(
        { component: "Checkbox", props: { label: "Email", name: "email" } },
        { component: "TextInput", props: { label: "Updates", name: "updates" } },
        submit,
      ),
      actions,
    );
    assert.deepEqual(result.errors, [
      'tree.children.0 Checkbox named "email" fills a string of action "sign_up": use a TextInput or Select',
      'tree.children.1 TextInput named "updates" fills a boolean of action "sign_up": use a Checkbox',
    ]);
  });

  it("refuses a password TextInput bound to an action property", async () => {
    const result = await check(
      form({ component: "TextInput", props: { label: "Email", name: "email", type: "password" } }, submit),
      actions,
    );
    assert.deepEqual(result.errors, [
      'tree.children.0 TextInput named "email" is a password field, which can\'t send its value to action "sign_up"',
    ]);
  });

  it("counts binding errors toward the 20-entry cap", async () => {
    const result = await check(
      form(...Array.from({ length: 25 }, () => ({ component: "Button", props: { label: "x", action: "nope" } }))),
      actions,
    );
    assert.equal(result.errors.length, 20);
    assert.equal(result.errors[19], "…and 6 more");
  });

  it("gives the same result as before for a tree without bindings, with or without actions", async () => {
    const trees = [
      form(button, { component: "TextInput", props: { label: "Email", type: "password" } }),
      form({ component: "Button" }, { component: "Nope" }),
    ];
    for (const tree of trees) {
      assert.deepEqual(await check(tree, actions), await check(tree));
      assert.deepEqual(await check(tree, []), await check(tree));
    }
  });
});

const updateItem: ActionSpec = {
  name: "menu_update_item",
  description: "Change an item.",
  operation: "edit",
  choices: { item: "menu_items" },
  input_schema: {
    type: "object",
    properties: {
      item: { type: "string", description: "The item to change." },
      name: { type: "string", description: "Its new name." },
      description: { type: "string", description: "Its new description." },
      category: { type: "string", description: "Its new category." },
    },
    required: ["item"],
    additionalProperties: false,
  },
};
const archiveItem: ActionSpec = {
  name: "menu_archive_item",
  description: "Archive an item.",
  operation: "archive",
  choices: { item: "menu_items" },
  input_schema: {
    type: "object",
    properties: { item: { type: "string", description: "The item to archive." } },
    required: ["item"],
    additionalProperties: false,
  },
};
const menuValues = { menu_items: ["Bạc xỉu", "Cà phê sữa đá"] };

const itemSelect = (...options: string[]) => ({
  component: "Select",
  props: { label: "Item", options, name: "item" },
});
const nameInput = { component: "TextInput", props: { label: "Name", name: "name" } };
const actionButton = (action: string, disabled = false) => ({
  component: "Button",
  props: { label: "Go", action, disabled },
});

describe("validateUiTree dropdown checks", () => {
  const menuActions = [updateItem, archiveItem];
  const editForm = (item: unknown) => form(item, nameInput, actionButton("menu_update_item"));

  it("accepts a Select listing all or some of the source's values", async () => {
    for (const select of [itemSelect("Bạc xỉu", "Cà phê sữa đá"), itemSelect("Cà phê sữa đá")]) {
      assert.deepEqual((await check(editForm(select), menuActions, menuValues)).errors, []);
    }
  });

  it("refuses a Select option that isn't exactly one of the source's values", async () => {
    const result = await check(editForm(itemSelect("Bạc xỉu", "Latte", "Bac xiu")), menuActions, menuValues);
    assert.deepEqual(result.errors, [
      'tree.children.0.props.options "Latte" is not one of the menu_items values (call list_actions to get them)',
      'tree.children.0.props.options "Bac xiu" is not one of the menu_items values (call list_actions to get them)',
    ]);
  });

  it("refuses an input that isn't a Select, instead of the input-kind message", async () => {
    for (const component of ["TextInput", "Checkbox"]) {
      const result = await check(
        editForm({ component, props: { label: "Item", name: "item" } }),
        menuActions,
        menuValues,
      );
      assert.deepEqual(result.errors, [
        'tree.children.0 fills "item" of action "menu_update_item", which takes one of the menu_items values: use a Select with those values as options',
      ]);
    }
  });

  it("checks inputs for a disabled Button's action too", async () => {
    const result = await check(
      form(itemSelect("Latte"), actionButton("menu_archive_item", true)),
      menuActions,
      menuValues,
    );
    assert.deepEqual(result.errors, [
      'tree.children.0.props.options "Latte" is not one of the menu_items values (call list_actions to get them)',
    ]);
  });

  it("reports a bad option once when several actions share its source", async () => {
    const tree = form(itemSelect("Latte"), nameInput, actionButton("menu_update_item"), actionButton("menu_archive_item"));
    assert.deepEqual((await check(tree, menuActions, menuValues)).errors, [
      'tree.children.0.props.options "Latte" is not one of the menu_items values (call list_actions to get them)',
    ]);
  });

  it("doesn't check a source missing from choiceValues", async () => {
    const textItem = { component: "TextInput", props: { label: "Item", name: "item" } };
    for (const item of [itemSelect("Latte"), textItem]) {
      assert.deepEqual((await check(editForm(item), menuActions, { menu_categories: ["Tea"] })).errors, []);
      assert.deepEqual((await check(editForm(item), menuActions)).errors, []);
    }
  });
});

describe("validateUiTree edit-form check", () => {
  const onlyRequired = (spec: ActionSpec, disabled = false) =>
    check(form(itemSelect("Latte"), actionButton(spec.name, disabled)), [spec]);

  it("refuses an edit action with only required inputs, naming its optional properties in schema order", async () => {
    assert.deepEqual((await onlyRequired(updateItem)).errors, [
      'tree.children.1 action "menu_update_item" changes nothing without an input for one of: name, description, category',
    ]);
  });

  it("accepts an edit form with one optional input", async () => {
    const tree = form(itemSelect("Latte"), nameInput, actionButton("menu_update_item"));
    assert.deepEqual((await check(tree, [updateItem])).errors, []);
  });

  it("doesn't check a disabled Button, or actions that aren't edits", async () => {
    assert.deepEqual((await onlyRequired(updateItem, true)).errors, []);
    const { operation: _, ...noOperation } = updateItem;
    for (const spec of [{ ...updateItem, operation: "create" as const }, noOperation]) {
      assert.deepEqual((await onlyRequired(spec)).errors, []);
    }
  });

  it("never refuses an edit action without optional properties", async () => {
    assert.deepEqual((await onlyRequired({ ...archiveItem, operation: "edit" })).errors, []);
  });
});
