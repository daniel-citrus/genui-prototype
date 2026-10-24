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
});
