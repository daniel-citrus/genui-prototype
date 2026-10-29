import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanName, foldName, optionLabel, sizeLabel } from "./names";

describe("cleanName", () => {
  it("trims and stores one Unicode form", () => {
    assert.equal(cleanName("  Cà phê \n"), "Cà phê");
    assert.equal(cleanName("Cà phê"), "Cà phê");
  });
});

describe("foldName", () => {
  it("folds accents, đ, case and punctuation alike", () => {
    assert.equal(foldName("Cà phê Sữa Đá"), "ca phe sua da");
    assert.equal(foldName("ca phe sua da"), "ca phe sua da");
    assert.equal(foldName("CÀ-PHÊ  sữa, đá!"), "ca phe sua da");
    assert.equal(foldName("Đậu đỏ"), "dau do");
  });

  it("folds a name of only symbols to nothing", () => {
    assert.equal(foldName(" !? "), "");
  });
});

describe("sizeLabel", () => {
  it("adds a named size in parentheses", () => {
    assert.equal(sizeLabel("Bạc xỉu", "L"), "Bạc xỉu (L)");
  });

  it("leaves out a missing or blank size", () => {
    assert.equal(sizeLabel("X", ""), "X");
    assert.equal(sizeLabel("X", "  "), "X");
    assert.equal(sizeLabel("X", undefined), "X");
  });
});

describe("optionLabel", () => {
  it("puts the option after its group and a colon", () => {
    assert.equal(optionLabel("Mức đá (Ice level)", "Ít đá"), "Mức đá (Ice level): Ít đá");
  });
});
