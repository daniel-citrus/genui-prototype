import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tabForKey, tabPanels, tabsMode } from "./tabs";

describe("tabsMode", () => {
  it("draws a tab bar up to 4 labels and a dropdown from 5", () => {
    assert.equal(tabsMode(2), "bar");
    assert.equal(tabsMode(4), "bar");
    assert.equal(tabsMode(5), "select");
    assert.equal(tabsMode(20), "select");
  });
});

describe("tabForKey", () => {
  it("moves right and left, wrapping at both ends", () => {
    assert.equal(tabForKey("ArrowRight", 0, 3), 1);
    assert.equal(tabForKey("ArrowRight", 2, 3), 0);
    assert.equal(tabForKey("ArrowLeft", 1, 3), 0);
    assert.equal(tabForKey("ArrowLeft", 0, 3), 2);
  });

  it("goes to the first tab on Home and the last on End", () => {
    assert.equal(tabForKey("Home", 2, 4), 0);
    assert.equal(tabForKey("End", 0, 4), 3);
  });

  it("ignores other keys", () => {
    for (const key of ["ArrowUp", "ArrowDown", "Enter", " ", "a"]) assert.equal(tabForKey(key, 1, 3), undefined, key);
  });
});

describe("tabPanels", () => {
  it("pairs each label with the child in the same place", () => {
    assert.deepEqual(tabPanels(["Starters", "Mains"], ["a", "b"]), [
      { label: "Starters", panel: "a" },
      { label: "Mains", panel: "b" },
    ]);
  });

  it("leaves out a child without a label and keeps a label without a child", () => {
    assert.deepEqual(tabPanels(["Starters", "", 3, "Mains"], ["a", "b", "c", "d", "e"]), [
      { label: "Starters", panel: "a" },
      { label: "Mains", panel: "d" },
    ]);
    assert.deepEqual(tabPanels(["Starters", "Mains"], ["a"]), [
      { label: "Starters", panel: "a" },
      { label: "Mains", panel: undefined },
    ]);
  });

  it("draws nothing when labels is not an array", () => {
    assert.deepEqual(tabPanels("Starters", ["a"]), []);
    assert.deepEqual(tabPanels(undefined, ["a"]), []);
  });
});
