import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { Component } from "shared/components";
import type { CustomComponentDefinition } from "shared/customComponents";
import { MARKUP_HTML_TAGS } from "shared/markup";
import type { ActionSpec } from "../actions/types";
import { catalog as entries } from "../catalog/components";
import { InMemoryComponentRepository } from "../ports/fakes/InMemoryComponentRepository";
import { InMemoryCustomComponentRepository } from "../ports/fakes/InMemoryCustomComponentRepository";
import { validateDefinition } from "./definition";
import { barChart, menuItemCard, panel, specials, withTemplate } from "./testDefinitions";

const htmlAllowed = ` (allowed: ${Object.keys(MARKUP_HTML_TAGS).join(", ")})`;

const addToCart: ActionSpec = {
  name: "add_to_cart",
  description: "Adds the item to the cart.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
};

const text = (value: unknown) => ({ component: "Text", props: { text: value } });

describe("validateDefinition", () => {
  let catalog: Component[];
  let repo: InMemoryCustomComponentRepository;

  beforeEach(async () => {
    catalog = await new InMemoryComponentRepository(entries).list();
    repo = new InMemoryCustomComponentRepository();
  });

  const validate = (definition: unknown) =>
    validateDefinition(definition, { catalog, resolve: (name) => repo.getByName(name), actions: [addToCart] });

  /** The problems with `menuItemCard` changed by `changes`. */
  const problems = async (changes: Partial<Record<keyof CustomComponentDefinition, unknown>>) => {
    const result = await validate({ ...menuItemCard, ...changes });
    assert.equal(result.ok, false);
    return result.ok ? [] : result.errors;
  };

  /** `menuItemCard`'s template with `child` added to the card. */
  const withChild = (child: unknown) => ({
    ...menuItemCard.template,
    children: [...(menuItemCard.template.children ?? []), child],
  });

  it("accepts a composed definition, a Markup one and a wrapper with a slot", async () => {
    for (const definition of [menuItemCard, barChart, panel]) {
      assert.deepEqual(await validate(definition), { ok: true, definition });
    }
  });

  it("stores the template without an empty children array on a leaf and leaves the input alone", async () => {
    const template = { component: "Stack", children: [{ component: "Heading", props: { text: "Hi" }, children: [] }] };
    const definition = { ...menuItemCard, children: "none", template };
    const result = await validate(definition);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.definition.template, {
      component: "Stack",
      children: [{ component: "Heading", props: { text: "Hi" } }],
    });
    assert.deepEqual(template.children[0].children, []);

    const bad = { ...template, children: [{ component: "Heading", props: { text: "Hi" }, children: [text("x")] }] };
    assert.equal((await validate({ ...definition, template: bad })).ok, false);
  });

  it("accepts a definition that uses existing custom components", async () => {
    await repo.save(menuItemCard);
    await repo.save(panel);
    assert.deepEqual(await validate(specials), { ok: true, definition: specials });
  });

  it("refuses missing and extra keys", async () => {
    const { template: _, ...rest } = menuItemCard;
    const result = await validate({ ...rest, version: 2 });
    assert.equal(result.ok, false);
    assert.deepEqual(result.ok ? [] : result.errors.slice(0, 2), ["template is required", "version is not allowed"]);
    assert.deepEqual(await validate([]), { ok: false, errors: ["definition must be an object"] });
  });

  it("refuses a bad name and catalog names in any case", async () => {
    assert.deepEqual(await problems({ name: "menu-card" }), ["name must match ^[A-Z][A-Za-z0-9]*$"]);
    assert.deepEqual(await problems({ name: "BUTTON" }), ['name "BUTTON" is taken by the catalog component Button']);
    assert.deepEqual(await problems({ name: "Markup" }), ['name "Markup" is taken by the catalog component Markup']);
    assert.deepEqual(await problems({ name: "button" }), [
      "name must match ^[A-Z][A-Za-z0-9]*$",
      'name "button" is taken by the catalog component Button',
    ]);
  });

  it("refuses an empty, long or multi-line description and a bad category or children", async () => {
    assert.deepEqual(await problems({ description: " " }), ["description must not be empty"]);
    assert.deepEqual(await problems({ description: "x".repeat(301) }), ["description is 301 characters (max 300)"]);
    assert.deepEqual(await problems({ description: "Two\nlines" }), [
      "description must be plain text, without line breaks or other control characters",
    ]);
    assert.deepEqual(await problems({ category: "chart" }), ["category must be one of layout, text, input, display"]);
    assert.deepEqual(await problems({ children: "some" }), ['children must be "none" or "any"']);
  });

  it("refuses an invalid props schema and example props that don't match it", async () => {
    const properties = { ...menuItemCard.propsSchema.properties, name: { type: "string" } };
    assert.deepEqual(await problems({ propsSchema: { ...menuItemCard.propsSchema, properties } }), [
      "propsSchema.properties.name.description must not be empty",
    ]);
    assert.deepEqual(await problems({ propsSchema: { ...menuItemCard.propsSchema, additionalProperties: true } }), [
      "propsSchema.additionalProperties must be false",
    ]);
    assert.deepEqual(await problems({ propsSchema: { ...menuItemCard.propsSchema, $id: "card" } }), [
      "propsSchema.$id is not allowed",
    ]);
    assert.deepEqual(await problems({ exampleProps: { name: "Latte", photo: menuItemCard.exampleProps.photo } }), [
      "exampleProps.price is required",
    ]);
  });

  it("refuses example props that break their own schema without naming the definition", async () => {
    const errors = await problems({ exampleProps: { ...menuItemCard.exampleProps, name: 5, size: "lg" } });
    assert.deepEqual(errors, ["exampleProps.size is not allowed", "exampleProps.name must be string"]);
  });

  it("refuses a definition over 8,000 characters", async () => {
    const errors = await problems({ template: withChild(text("x".repeat(8000))) });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^definition is \d+ characters as JSON \(max 8000\)$/);
  });

  it("refuses templates over 40 nodes or 6 levels", async () => {
    const wide = { component: "Stack", children: Array.from({ length: 40 }, () => text("x")) };
    assert.deepEqual(await problems({ template: wide }), ["template has 41 nodes (max 40)"]);
    let deep: CustomComponentDefinition["template"] = text("x");
    for (let i = 0; i < 6; i++) deep = { component: "Stack", children: [deep] };
    assert.deepEqual(await problems({ template: deep }), ["template is 7 levels deep (max 6)"]);
  });

  it("refuses malformed template nodes", async () => {
    assert.deepEqual(await problems({ template: withChild({ component: "Text", text: "Hi" }) }), [
      "template.children.3.text is not allowed (use component, props, children)",
    ]);
    assert.deepEqual(await problems({ template: withChild("Text") }), [
      'template.children.3 must be an object with a "component" string',
    ]);
  });

  it("refuses undeclared and misplaced $props", async () => {
    assert.deepEqual(await problems({ template: withChild(text({ $prop: "subtitle" })) }), [
      'template.children.3.props.text uses $prop "subtitle", which propsSchema.properties doesn\'t declare',
    ]);
    assert.deepEqual(await problems({ template: withChild(text({ $prop: "name", fallback: "x" })) }), [
      'template.children.3.props.text must be exactly {"$prop": "<name>"}',
    ]);
    const select = { component: "Select", props: { label: "Size", options: [{ $prop: "name" }] } };
    assert.deepEqual(await problems({ template: withChild(select) }), [
      'template.children.3.props.options.0 {"$prop"} is only allowed as a whole prop value or a Markup text, attribute or style value',
    ]);
    const button = { tag: "button", action: { $prop: "name" }, text: "Add" };
    assert.deepEqual(await problems({ template: withChild({ component: "Markup", props: { root: button } }) }), [
      'template.children.3.props.root.action {"$prop"} is only allowed as a whole prop value or a Markup text, attribute or style value',
    ]);
  });

  it("refuses a misplaced or second slot, a slot with children none, and no slot with children any", async () => {
    const slot = { $children: true };
    assert.deepEqual(await problems({ children: "any", template: withChild({ ...text("x"), props: { text: slot } }) }), [
      'template.children.3.props.text {"$children": true} is only allowed in a children array',
    ]);
    assert.deepEqual(await problems({ children: "any", template: { component: "Stack", children: [slot, slot] } }), [
      'template.children.1 is a second {"$children": true} slot (template.children.0 is the first; only one is allowed)',
    ]);
    assert.deepEqual(await problems({ template: withChild(slot) }), [
      'template.children.3 {"$children": true} is not allowed when children is "none"',
    ]);
    assert.deepEqual(await problems({ children: "any" }), [
      'template needs a {"$children": true} slot in a children array, since children is "any"',
    ]);
  });

  it("refuses unknown and deleted components", async () => {
    await repo.save(panel);
    await repo.softDelete("Panel");
    assert.deepEqual(
      await problems({ template: withChild({ component: "Panel", props: { title: "x" } }) }),
      ['template.children.3.component "Panel" was deleted; restore it in the Components panel or use another component'],
    );
    assert.deepEqual(await problems({ template: withChild({ component: "Ghost" }) }), [
      'template.children.3.component "Ghost" is not a catalog or custom component',
    ]);
    assert.deepEqual(await problems({ template: withChild({ component: "badge", props: { text: "x" } }) }), [
      'template.children.3.component "badge" is not a catalog or custom component (did you mean Badge?)',
    ]);
  });

  it("refuses a fourth level of custom components", async () => {
    await repo.save(withTemplate("Level3", text("deep")));
    await repo.save(withTemplate("Level2", { component: "Stack", children: [{ component: "Level3" }] }));
    assert.equal((await validate(withTemplate("Level1", { component: "Level2" }))).ok, true);
    await repo.save(withTemplate("Level1", { component: "Level2" }));

    const result = await validate(withTemplate("Level0", { component: "Card", children: [{ component: "Level1" }] }));
    assert.deepEqual(result, {
      ok: false,
      errors: [
        'template.children.0 (Level1 v1) template (Level2 v1) template.children.0.component "Level3" nests custom components 4 levels deep (max 3): Level0 → Level1 → Level2 → Level3',
      ],
    });
  });

  it("refuses a definition that reaches itself", async () => {
    assert.deepEqual(await validate(withTemplate("Echo", { component: "Stack", children: [{ component: "Echo" }] })), {
      ok: false,
      errors: ['template.children.0.component "Echo" makes a loop: Echo → Echo'],
    });

    await repo.save(withTemplate("Ping", text("ping")));
    await repo.save(withTemplate("Pong", { component: "Stack", children: [{ component: "Ping" }] }));
    assert.deepEqual(await validate(withTemplate("Ping", { component: "Card", children: [{ component: "Pong" }] })), {
      ok: false,
      errors: [
        'template.children.0 (Pong v1) template.children.0.component "Ping" makes a loop: Ping → Pong → Ping',
      ],
    });
  });

  it("refuses a Button action that isn't registered and accepts one that is", async () => {
    const button = (action: string) => ({ component: "Button", props: { label: "Add", action } });
    assert.deepEqual(await problems({ template: withChild(button("buy")) }), [
      'template.children.3.props.action "buy" is not a registered action (call list_actions to see them)',
    ]);
    assert.equal((await validate({ ...menuItemCard, template: withChild(button("add_to_cart")) })).ok, true);
  });

  it("refuses catalog prop and Markup problems in the expanded example", async () => {
    const heading = { component: "Heading", props: { text: { $prop: "name" }, level: 7 } };
    assert.deepEqual(await problems({ template: withChild(heading) }), [
      "template.children.3.props.level must be one of 1, 2, 3 (call get_component Heading for its props)",
    ]);
    const script = { tag: "div", children: [{ tag: "script", text: "alert(1)" }] };
    assert.deepEqual(await problems({ template: withChild({ component: "Markup", props: { root: script } }) }), [
      `template.children.3.props.root.children.0.tag "script" is not allowed${htmlAllowed}`,
    ]);
  });

  it("points guessed Markup props at get_component", async () => {
    const priceTag = {
      ...withTemplate("PriceTag", {
        component: "Markup",
        props: { markup: "<span><strong>{{price}}</strong></span>" },
        children: [],
      }),
      propsSchema: {
        type: "object",
        properties: { price: { type: "string", description: "The price." } },
        required: ["price"],
        additionalProperties: false,
      },
      exampleProps: { price: "$4.50" },
    };
    assert.deepEqual(await validate(priceTag), {
      ok: false,
      errors: [
        "template.props.root is required (call get_component Markup for its props)",
        "template.props.markup is not allowed",
      ],
    });
  });

  it("reports every problem together, at most 20", async () => {
    const result = await validate({
      ...menuItemCard,
      name: "menu",
      description: "",
      template: { component: "Stack", children: Array.from({ length: 30 }, (_, i) => text({ $prop: `p${i}` })) },
    });
    assert.equal(result.ok, false);
    const errors = result.ok ? [] : result.errors;
    assert.equal(errors.length, 20);
    assert.deepEqual(errors.slice(0, 2), ["name must match ^[A-Z][A-Za-z0-9]*$", "description must not be empty"]);
    assert.equal(errors[19], "…and 13 more");
  });
});
