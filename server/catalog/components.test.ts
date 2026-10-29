import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileSchema } from "../validation/jsonSchema";
import { catalog } from "./components";
import { validateCatalog } from "./validate";

describe("catalog", () => {
  it("passes validateCatalog", () => {
    assert.deepEqual(validateCatalog(catalog), []);
  });

  it("describes Markup's root as a JSON tree with kebab-case style keys and $prop values", () => {
    const markup = catalog.find((c) => c.name === "Markup")!;
    const properties = markup.propsSchema.properties as Record<string, { description: string }>;
    for (const text of ["never an HTML string", "kebab-case", '{"$prop": "<name>"}']) {
      assert.ok(properties.root.description.includes(text), text);
    }
  });

  it("lets a Select start on an option and be disabled", () => {
    const select = catalog.find((c) => c.name === "Select")!;
    const properties = select.propsSchema.properties as Record<string, { type: string }>;
    assert.equal(properties.value.type, "string");
    assert.equal(properties.disabled.type, "boolean");
  });

  it("scopes input names to the Card and explains the Select lock", () => {
    for (const name of ["TextInput", "Checkbox", "Select"]) {
      const c = catalog.find((x) => x.name === name)!;
      const props = c.propsSchema.properties as Record<string, { description: string }>;
      assert.ok(props.name.description.includes("Unique within its Card."), name);
      assert.ok(!props.name.description.includes("Unique in the design"), name);
    }
    const card = catalog.find((c) => c.name === "Card")!;
    assert.match(card.description, /Button sends the inputs inside its Card/);
    const select = catalog.find((c) => c.name === "Select")!.propsSchema.properties as Record<string, { description: string }>;
    assert.match(select.value.description, /locks a form to one existing item/);
    assert.match(select.disabled.description, /lock the item a form edits/);
  });

  it("gives Tabs 2 to 20 unique non-empty labels, one panel each", () => {
    const tabs = catalog.find((c) => c.name === "Tabs")!;
    assert.equal(tabs.category, "layout");
    assert.equal(tabs.children, "any");
    assert.match(tabs.description, /one child per label, in the same order/);
    const valid = compileSchema(tabs.propsSchema as unknown as Record<string, unknown>);
    const labels = (n: number) => Array.from({ length: n }, (_, i) => `Group ${i + 1}`);
    assert.ok(valid({ labels: labels(2) }));
    assert.ok(valid({ labels: labels(20) }));
    for (const bad of [labels(1), labels(21), ["Mains", "Mains"], ["Mains", ""]]) {
      assert.ok(!valid({ labels: bad }), JSON.stringify(bad));
    }
    assert.ok(!valid({}));
  });

  it("gives Collapsible a required title and an open flag that defaults to closed", () => {
    const collapsible = catalog.find((c) => c.name === "Collapsible")!;
    assert.equal(collapsible.category, "layout");
    assert.equal(collapsible.children, "any");
    const properties = collapsible.propsSchema.properties as Record<string, { type: string; default?: unknown }>;
    assert.equal(properties.open.type, "boolean");
    assert.equal(properties.open.default, false);
    assert.deepEqual(collapsible.propsSchema.required, ["title"]);
  });

  it("no longer limits Markup to templates and points to its rules", () => {
    const markup = catalog.find((c) => c.name === "Markup")!;
    const root = (markup.propsSchema.properties as Record<string, { description: string }>).root;
    assert.equal(
      markup.description,
      "Draws allowlisted HTML and SVG elements from a JSON tree, for what no other component can show, such as a bar chart, a star rating, or a bullet or numbered list. Follow the Markup rules listed with the catalog.",
    );
    assert.ok(!markup.description.includes("Only used inside custom component templates"));
    assert.ok(!root.description.includes("Only used inside custom component templates"));
    assert.match(markup.description, /Markup rules/);
    assert.match(
      root.description,
      /The root element: \{ "tag", "attrs"\?, "style"\?, "text"\?, "action"\?, "children"\? \}, a JSON tree, never an HTML string/,
    );
  });
});
