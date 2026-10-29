import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CatalogComponent } from "shared/components";
import { catalog } from "./components";
import { validateCatalog } from "./validate";

/** A copy of the real catalog with `edit` applied to the entry named `name`. */
function withEdit(name: string, edit: (c: Record<string, any>) => void): CatalogComponent[] {
  const copy = structuredClone(catalog);
  const entry = copy.find((c) => c.name === name);
  assert.ok(entry, `no ${name} in the catalog`);
  edit(entry as unknown as Record<string, any>);
  return copy;
}

function assertProblem(problems: string[], expected: RegExp) {
  assert.ok(
    problems.some((p) => expected.test(p)),
    `expected a problem matching ${expected}, got ${JSON.stringify(problems)}`,
  );
}

describe("validateCatalog", () => {
  it("accepts the real catalog of fifteen components", () => {
    assert.equal(catalog.length, 15);
    assert.deepEqual(validateCatalog(catalog), []);
  });

  it("gives Button an optional action prop and inputs an optional name prop", () => {
    const prop = (component: string, key: string) => {
      const entry = catalog.find((c) => c.name === component);
      const schema = entry?.propsSchema as unknown as {
        properties: Record<string, Record<string, unknown>>;
        required: string[];
      };
      assert.ok(!schema.required.includes(key), `${component}.${key} is required`);
      const { description, ...rest } = schema.properties[key] ?? {};
      assert.equal(typeof description, "string");
      return { description: description as string, rest };
    };
    const action = prop("Button", "action");
    assert.deepEqual(action.rest, { type: "string", pattern: "^[a-z][a-z0-9_]*$", maxLength: 64 });
    assert.match(action.description, /listed action/);
    for (const component of ["TextInput", "Checkbox", "Select"]) {
      const name = prop(component, "name");
      assert.deepEqual(name.rest, { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]*$", maxLength: 64 });
      assert.match(name.description, /[Uu]nique/);
    }
  });

  it("reports a broken schema", () => {
    const problems = validateCatalog(
      withEdit("Button", (c) => {
        c.propsSchema.properties.size.type = "strng";
      }),
    );
    assertProblem(problems, /^Button: propsSchema is not a valid JSON Schema: /);
  });

  it("reports a default that does not fit its property", () => {
    const problems = validateCatalog(
      withEdit("Button", (c) => {
        c.propsSchema.properties.variant.default = "loud";
      }),
    );
    assert.deepEqual(problems, [
      "Button: propsSchema.properties.variant.default must be equal to one of the allowed values",
    ]);
  });

  it("reports example props that do not match the schema", () => {
    const problems = validateCatalog(
      withEdit("Button", (c) => {
        c.exampleProps = { variant: "loud", extra: 1 };
      }),
    );
    assert.deepEqual(problems.sort(), [
      "Button: exampleProps.extra is not allowed",
      "Button: exampleProps.label is required",
      "Button: exampleProps.variant must be equal to one of the allowed values",
    ]);
  });

  it("reports a property without a description", () => {
    const problems = validateCatalog(
      withEdit("Alert", (c) => {
        delete c.propsSchema.properties.title.description;
      }),
    );
    assert.deepEqual(problems, ["Alert: propsSchema.properties.title.description must not be empty"]);
  });

  it("reports additionalProperties left open", () => {
    const problems = validateCatalog(
      withEdit("Card", (c) => {
        delete c.propsSchema.additionalProperties;
      }),
    );
    assert.deepEqual(problems, ["Card: propsSchema.additionalProperties must be false"]);
  });

  it("reports a bad name", () => {
    const problems = validateCatalog(
      withEdit("Badge", (c) => {
        c.name = "my-badge";
      }),
    );
    assertProblem(problems, /^my-badge: name must match /);
  });

  it("reports a duplicate name", () => {
    const problems = validateCatalog(
      withEdit("Badge", (c) => {
        c.name = "Alert";
      }),
    );
    assert.deepEqual(problems, ["Alert: name is used more than once"]);
  });

  it("reports an empty description", () => {
    const problems = validateCatalog(
      withEdit("Text", (c) => {
        c.description = " ";
      }),
    );
    assert.deepEqual(problems, ["Text: description must not be empty"]);
  });

  it("lists every problem across components", () => {
    const broken = withEdit("Button", (c) => {
      c.propsSchema.properties.variant.default = "loud";
    });
    const heading = broken.find((c) => c.name === "Heading")!;
    heading.exampleProps = {};
    assert.deepEqual(validateCatalog(broken), [
      "Heading: exampleProps.text is required",
      "Button: propsSchema.properties.variant.default must be equal to one of the allowed values",
    ]);
  });
});
