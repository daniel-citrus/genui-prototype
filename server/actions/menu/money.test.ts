import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPrice, parsePrice } from "./money";

const usd = (amount: number) => ({ amount, currency: "USD" });

describe("parsePrice", () => {
  it("accepts whole dollars, one or two decimals, a dollar sign and thousands commas", () => {
    assert.deepEqual(parsePrice("4"), usd(400));
    assert.deepEqual(parsePrice("4.5"), usd(450));
    assert.deepEqual(parsePrice("4.50"), usd(450));
    assert.deepEqual(parsePrice("$4.50"), usd(450));
    assert.deepEqual(parsePrice("  $1,234.05 "), usd(123405));
    assert.deepEqual(parsePrice("0"), usd(0));
  });

  it("rounds to whole cents where floats drift", () => {
    assert.deepEqual(parsePrice("0.29"), usd(29));
    assert.deepEqual(parsePrice("1.15"), usd(115));
  });

  it("refuses anything else", () => {
    const notPrices = ["", " ", "abc", "4.505", "-4", "4.", ".5", "4.5.0", "1e3", "€4", "4 50", "99999999999999999"];
    for (const text of notPrices) {
      assert.equal(parsePrice(text), null, text);
    }
  });
});

describe("formatPrice", () => {
  it("writes dollars with two decimals", () => {
    assert.equal(formatPrice(usd(450)), "$4.50");
    assert.equal(formatPrice(usd(600)), "$6.00");
    assert.equal(formatPrice(usd(0)), "$0.00");
    assert.equal(formatPrice(usd(123405)), "$1,234.05");
  });
});
