import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalog } from "../../server/catalog/components";
import { RENDERED_COMPONENTS } from "./componentNames";

describe("RENDERED_COMPONENTS", () => {
  it("lists the same components as the server catalog", () => {
    assert.deepEqual([...RENDERED_COMPONENTS].sort(), catalog.map((c) => c.name).sort());
  });

  it("has no duplicates", () => {
    assert.equal(new Set(RENDERED_COMPONENTS).size, RENDERED_COMPONENTS.length);
  });
});
