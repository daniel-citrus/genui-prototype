import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fillConfirm } from "./confirm";

describe("fillConfirm", () => {
  it("replaces a placeholder with its value", () => {
    assert.equal(
      fillConfirm("Delete the category {category}?", { category: "Trà" }),
      "Delete the category Trà?",
    );
  });

  it("reads (none) for an empty or missing value", () => {
    assert.equal(fillConfirm("Delete {item}?", { item: "" }), "Delete (none)?");
    assert.equal(fillConfirm("Delete {item}?", {}), "Delete (none)?");
  });

  it("fills every placeholder, booleans as text, and leaves other text alone", () => {
    assert.equal(
      fillConfirm("Remove {size} from {item} (forever: {forever})?", {
        item: "Latte",
        size: "L",
        forever: true,
      }),
      "Remove L from Latte (forever: true)?",
    );
    assert.equal(fillConfirm("Delete everything?", { item: "Latte" }), "Delete everything?");
  });

  it("does not read inherited properties", () => {
    assert.equal(fillConfirm("{constructor}", {}), "(none)");
  });
});
