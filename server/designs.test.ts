import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UiNode } from "shared/ui";
import { createDesignStore } from "./designs";

const design = (n: number): UiNode => ({ component: "Card", props: { title: `design ${n}` } });

describe("createDesignStore", () => {
  it("keeps the newest `max` designs and drops the oldest", () => {
    const store = createDesignStore({ max: 3 });
    for (let n = 1; n <= 3; n++) store.remember(`d${n}`, design(n));
    for (let n = 1; n <= 3; n++) assert.deepEqual(store.get(`d${n}`), design(n));

    store.remember("d4", design(4));
    assert.equal(store.get("d1"), undefined);
    for (let n = 2; n <= 4; n++) assert.deepEqual(store.get(`d${n}`), design(n));
  });

  it("returns undefined for an unknown id", () => {
    const store = createDesignStore({ max: 3 });
    store.remember("known", design(1));
    assert.equal(store.get("other"), undefined);
  });

  it("counts a design remembered again as newest, without growing", () => {
    const store = createDesignStore({ max: 2 });
    store.remember("a", design(1));
    store.remember("b", design(2));
    store.remember("a", design(3));
    store.remember("c", design(4));
    assert.equal(store.get("b"), undefined);
    assert.deepEqual(store.get("a"), design(3));
    assert.deepEqual(store.get("c"), design(4));
  });
});
