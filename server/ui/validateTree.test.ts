import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Component } from "shared/components";
import { MARKUP_HTML_TAGS } from "shared/markup";
import type { ActionSpec } from "../actions/types";
import { catalog } from "../catalog/components";
import { InMemoryComponentRepository } from "../ports/fakes/InMemoryComponentRepository";
import { type UiTreeOptions, validateUiTree, validatorCompileCount, withPropsHint } from "./validateTree";

const htmlAllowed = ` (allowed: ${Object.keys(MARKUP_HTML_TAGS).join(", ")})`;

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

  it("reports props that break the schema, pointing the first at its propsSchema", async () => {
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
      "tree.children.0.props.label is required (see Button's propsSchema)",
      "tree.children.1.props.label must be string",
      "tree.children.2.props.variant must be one of primary, secondary, danger",
      "tree.children.3.props.color is not allowed",
    ]);
  });

  it("points each component's first props problem at its propsSchema, enums included", async () => {
    const result = await check({
      component: "Stack",
      children: [
        { component: "Button", props: { label: "x", variant: "huge" } },
        { component: "Heading" },
        { component: "Button" },
        { component: "Heading", props: { text: 3 } },
      ],
    });
    assert.deepEqual(result.errors, [
      "tree.children.0.props.variant must be one of primary, secondary, danger (see Button's propsSchema)",
      "tree.children.1.props.text is required (see Heading's propsSchema)",
      "tree.children.2.props.label is required",
      "tree.children.3.props.text must be string",
    ]);
  });

  it("adds no propsSchema hint to problems that don't come from the props schema", async () => {
    const result = await check({
      component: "Stack",
      children: [
        { component: "Carousel" },
        { component: "Divider", props: [] },
        { ...button, children: [button] },
        { component: "Markup", props: { root: { tag: "script" } } },
        { component: "TextInput", props: { label: "A", name: "dup" } },
        { component: "TextInput", props: { label: "B", name: "dup" } },
      ],
    });
    assert.deepEqual(result.errors, [
      'tree.children.0.component "Carousel" is not in the catalog',
      "tree.children.1.props must be an object",
      "tree.children.2 Button cannot have children",
      `tree.children.3.props.root.tag "script" is not allowed${htmlAllowed}`,
      'tree.children.5.props.name "dup" is already used by tree.children.4',
    ]);
    const wide = { component: "Stack", children: [button, button] };
    const sized = validateUiTree(wide, await stored(), undefined, undefined, { maxNodes: 2 });
    assert.deepEqual(sized.errors, ["tree has 3 nodes (max 2)"]);
  });

  it("rejects children on a component that takes none", async () => {
    const result = await check({ component: "Stack", children: [{ ...button, children: [button] }] });
    assert.deepEqual(result.errors, ["tree.children.0 Button cannot have children"]);
  });

  it("accepts an empty children array on a component that takes none, without removing it", async () => {
    const heading = { component: "Heading", props: { text: "Hello" }, children: [] };
    const result = await check({ component: "Stack", children: [heading, { component: "Stack", children: [] }] });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(heading.children, []);
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
      children: [{ component: "nope" }, { component: "Button" }, { component: "Divider", children: [{ component: "Divider" }] }],
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

describe("validateUiTree Select value", () => {
  const select = (props: Record<string, unknown>) => ({
    component: "Select",
    props: { label: "Item", name: "item", options: ["Bạc xỉu", "Latte"], ...props },
  });

  it("accepts a preset, locked Select", async () => {
    assert.deepEqual((await check(form(select({ value: "Bạc xỉu", disabled: true })))).errors, []);
  });

  it("refuses a value that isn't one of the options", async () => {
    const result = await check(form(select({ value: "Mocha" })));
    assert.deepEqual(result.errors, ['tree.children.0.props.value "Mocha" is not one of its options']);
  });

  it("refuses a disabled Select without a value", async () => {
    const result = await check(form(select({ disabled: true })));
    assert.deepEqual(result.errors, ["tree.children.0 a disabled Select needs a value"]);
  });
});

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
      component: "Stack",
      children: [{ component: "Checkbox", props: { label: "Again", name: "email" } }],
    });
    const expected = 'tree.children.1.children.0.props.name "email" is already used by tree.children.0';
    assert.deepEqual((await check(tree)).errors, [expected]);
    assert.ok((await check(tree, actions)).errors.includes(expected));
  });

  it("refuses an unregistered action and points at the listed ones", async () => {
    const result = await check(
      form(email, { component: "Button", props: { label: "Go", action: "sign_in" } }),
      actions,
    );
    assert.deepEqual(result.errors, [
      'tree.children.1.props.action "sign_in" is not a registered action (use a listed action, or leave it out)',
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
      'tree.children.0.props.options "Latte" is not one of the menu_items values (use the listed values)',
      'tree.children.0.props.options "Bac xiu" is not one of the menu_items values (use the listed values)',
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
      'tree.children.0.props.options "Latte" is not one of the menu_items values (use the listed values)',
    ]);
  });

  it("reports a bad option once when several actions share its source", async () => {
    const tree = form(itemSelect("Latte"), nameInput, actionButton("menu_update_item"), actionButton("menu_archive_item"));
    assert.deepEqual((await check(tree, menuActions, menuValues)).errors, [
      'tree.children.0.props.options "Latte" is not one of the menu_items values (use the listed values)',
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

const markup = (root: unknown) => ({ component: "Markup", props: { root } });

describe("validateUiTree Markup", () => {
  it("reports problems inside a Markup root at their path in the tree", async () => {
    const result = await check(form(markup({ tag: "div", attrs: { onclick: "x" }, children: [{ tag: "script" }] })));
    assert.deepEqual(result.errors, [
      "tree.children.0.props.root.attrs.onclick is not allowed",
      `tree.children.0.props.root.children.0.tag "script" is not allowed${htmlAllowed}`,
    ]);
  });

  it("checks the root only when it is an object", async () => {
    assert.deepEqual((await check({ component: "Markup" })).errors, [
      "tree.props.root is required (see Markup's propsSchema)",
    ]);
    assert.deepEqual((await check(markup("<b>x</b>"))).errors, [
      "tree.props.root must be object (see Markup's propsSchema)",
    ]);
  });

  it("doesn't count Markup elements toward the node and depth limits", async () => {
    let deep: unknown = { tag: "span" };
    for (let i = 0; i < 11; i++) deep = { tag: "div", children: [deep] };
    const wide = { tag: "div", children: Array.from({ length: 150 }, () => ({ tag: "span" })) };
    assert.deepEqual(await check(form(markup(deep), markup(wide))), {
      ok: true,
      errors: [],
      stats: { nodes: 3, depth: 2, components: { Stack: 1, Markup: 2 } },
    });
  });

  it("applies the binding checks to Markup inputs and buttons", async () => {
    const tree = form(
      email,
      markup({
        tag: "div",
        children: [
          { tag: "input", attrs: { name: "email", type: "email" } },
          { tag: "input", attrs: { name: "plan", type: "checkbox" } },
          { tag: "button", action: "sign_in", text: "Sign in" },
          { tag: "button", action: "sign_up", text: "Sign up" },
        ],
      }),
    );
    assert.deepEqual((await check(tree, actions)).errors, [
      'tree.children.1.props.root.children.0.attrs.name "email" is already used by tree.children.0',
      'tree.children.1.props.root.children.2.action "sign_in" is not a registered action (use a listed action, or leave it out)',
      'tree.children.1.props.root.children.1 Checkbox named "plan" fills a string of action "sign_up": use a TextInput or Select',
    ]);
  });

  it("checks a Markup select's options against a dropdown source", async () => {
    const select = {
      tag: "select",
      attrs: { name: "item" },
      children: [{ tag: "option", text: "Bạc xỉu" }, { tag: "option", attrs: { value: "Latte" }, text: "Latte" }],
    };
    const tree = form(markup(select), nameInput, actionButton("menu_update_item"));
    assert.deepEqual((await check(tree, [updateItem], menuValues)).errors, [
      'tree.children.0.props.root.children "Latte" is not one of the menu_items values (use the listed values)',
    ]);
  });
});

describe("validateUiTree options", () => {
  const withOptions = async (tree: unknown, specs: ActionSpec[] | undefined, options: UiTreeOptions) =>
    validateUiTree(tree, await stored(), specs, undefined, options);

  it("skips the missing-input and edit-form checks with designChecks: false", async () => {
    assert.equal((await check(form(submit), actions)).ok, false);
    assert.deepEqual((await withOptions(form(submit), actions, { designChecks: false })).errors, []);

    const edit = form(itemSelect("Latte"), actionButton("menu_update_item"));
    assert.equal((await check(edit, [updateItem])).ok, false);
    assert.deepEqual((await withOptions(edit, [updateItem], { designChecks: false })).errors, []);
  });

  it("keeps every other binding check with designChecks: false", async () => {
    const tree = form(email, email, { component: "Checkbox", props: { label: "E", name: "email" } }, actionButton("nope"));
    const options = { designChecks: false };
    assert.deepEqual((await withOptions(tree, actions, options)).errors, [
      'tree.children.1.props.name "email" is already used by tree.children.0',
      'tree.children.2.props.name "email" is already used by tree.children.0',
      'tree.children.3.props.action "nope" is not a registered action (use a listed action, or leave it out)',
    ]);
    const kinds = form({ component: "Checkbox", props: { label: "Email", name: "email" } }, submit);
    assert.deepEqual((await withOptions(kinds, actions, options)).errors, [
      'tree.children.0 Checkbox named "email" fills a string of action "sign_up": use a TextInput or Select',
    ]);
  });

  it("uses maxNodes and maxDepth instead of the defaults", async () => {
    const wide = { component: "Stack", children: Array.from({ length: 139 }, () => ({ component: "Divider" })) };
    assert.deepEqual((await withOptions(wide, undefined, { maxNodes: 140 })).errors, []);
    assert.deepEqual((await withOptions(wide, undefined, { maxNodes: 50 })).errors, ["tree has 140 nodes (max 50)"]);

    let deep: unknown = { component: "Divider" };
    for (let i = 0; i < 8; i++) deep = { component: "Stack", children: [deep] };
    assert.deepEqual((await withOptions(deep, undefined, { maxDepth: 9 })).errors, []);
    assert.deepEqual((await withOptions(deep, undefined, { maxDepth: 3 })).errors, ["tree is 9 levels deep (max 3)"]);
  });
});

describe("withPropsHint", () => {
  it("returns no problems unchanged and doesn't mark the name", () => {
    const hinted = new Set<string>();
    assert.deepEqual(withPropsHint([], "Button", hinted), []);
    assert.equal(hinted.size, 0);
  });

  it("hints the first problem for a new name and marks it", () => {
    const hinted = new Set<string>();
    const problems = ["tree.props.label is required", "tree.props.color is not allowed"];
    assert.deepEqual(withPropsHint(problems, "Button", hinted), [
      "tree.props.label is required (see Button's propsSchema)",
      "tree.props.color is not allowed",
    ]);
    assert.deepEqual(problems, ["tree.props.label is required", "tree.props.color is not allowed"]);
    assert.deepEqual([...hinted], ["Button"]);
  });

  it("returns the problems unchanged for a name already hinted", () => {
    const hinted = new Set(["Button"]);
    const problems = ["tree.children.1.props.label must be string"];
    assert.equal(withPropsHint(problems, "Button", hinted), problems);
    assert.deepEqual([...hinted], ["Button"]);
  });
});

describe("validateUiTree Card-scoped checks", () => {
  const menuActions = [updateItem];
  const itemCard = (extra: unknown[] = []) => ({
    component: "Card",
    children: [itemSelect("Bạc xỉu"), nameInput, ...extra, actionButton("menu_update_item")],
  });
  const errors = async (tree: unknown) => (await check(tree, menuActions, menuValues)).errors;

  it("accepts a Card per item, each with the same input names", async () => {
    assert.deepEqual(await errors(form(itemCard(), itemCard(), itemCard())), []);
  });

  it("refuses the same name twice in one Card", async () => {
    assert.deepEqual(await errors(form(itemCard([nameInput]))), [
      'tree.children.0.children.2.props.name "name" is already used by tree.children.0.children.1',
    ]);
  });

  it("refuses an outer button that would send the same name from two Cards", async () => {
    const tree = form(
      { component: "Card", children: [itemSelect("Bạc xỉu"), nameInput] },
      { component: "Card", children: [nameInput] },
      actionButton("menu_update_item"),
    );
    assert.ok(
      (await errors(tree)).includes(
        'tree.children.1.children.0.props.name "name" is also at tree.children.0.children.1, and the button at tree.children.2 would send both; put each form in its own Card',
      ),
    );
  });

  it("requires each button's own Card to hold the action's inputs", async () => {
    const noItem = { component: "Card", children: [nameInput, actionButton("menu_update_item")] };
    assert.deepEqual(await errors(form(itemCard(), noItem)), [
      'tree.children.1.children.1 action "menu_update_item" needs a Select named "item" in its Card, with the menu_items values as its options, and none has that name',
    ]);
  });

  it("runs the edit check for each button against its Card", async () => {
    const itemOnly = { component: "Card", children: [itemSelect("Bạc xỉu"), actionButton("menu_update_item")] };
    assert.deepEqual(await errors(form(itemCard(), itemOnly)), [
      'tree.children.1.children.1 action "menu_update_item" changes nothing without an input for one of: name, description, category',
    ]);
  });

  it("keeps the whole-design message for a button outside every Card", async () => {
    const tree = form(nameInput, actionButton("menu_update_item"));
    assert.deepEqual(await errors(tree), [
      'tree.children.1 action "menu_update_item" needs a Select named "item", with the menu_items values as its options, and none has that name',
    ]);
  });

  it("asks for a Select when a choice input is missing, even without choiceValues", async () => {
    const noItem = { component: "Card", children: [nameInput, actionButton("menu_update_item")] };
    const errorsWithoutValues = async (tree: unknown) => (await check(tree, menuActions)).errors;
    assert.deepEqual(await errorsWithoutValues(form(itemCard(), noItem)), [
      'tree.children.1.children.1 action "menu_update_item" needs a Select named "item" in its Card, with the menu_items values as its options, and none has that name',
    ]);
    const tree = form(nameInput, actionButton("menu_update_item"));
    assert.deepEqual(await errorsWithoutValues(tree), [
      'tree.children.1 action "menu_update_item" needs a Select named "item", with the menu_items values as its options, and none has that name',
    ]);
  });

  it("includes in its Card when sign_up is missing email inside a Card", async () => {
    const cardSubmit = { component: "Card", children: [submit] };
    assert.deepEqual((await check(form(cardSubmit), actions)).errors, [
      'tree.children.0.children.0 action "sign_up" needs an input named "email" in its Card, and none has that name',
    ]);
  });
});
