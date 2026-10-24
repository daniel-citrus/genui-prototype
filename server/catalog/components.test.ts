import assert from "node:assert/strict";
import { describe, it } from "node:test";
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

  it("no longer limits Markup to templates and points to its rules", () => {
    const markup = catalog.find((c) => c.name === "Markup")!;
    const root = (markup.propsSchema.properties as Record<string, { description: string }>).root;
    assert.equal(
      markup.description,
      "Draws allowlisted HTML and SVG elements from a JSON tree, for what no other component can show, such as a bar chart, a star rating, or a bullet or numbered list. Call get_component for Markup's full rules.",
    );
    assert.ok(!markup.description.includes("Only used inside custom component templates"));
    assert.ok(!root.description.includes("Only used inside custom component templates"));
    assert.match(markup.description, /get_component/);
    assert.match(
      root.description,
      /The root element: \{ "tag", "attrs"\?, "style"\?, "text"\?, "action"\?, "children"\? \}, a JSON tree, never an HTML string/,
    );
  });
});
