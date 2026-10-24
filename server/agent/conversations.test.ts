import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UiNode } from "shared/ui";
import {
  MAX_CONVERSATIONS,
  MAX_DESIGNS_PER_CONVERSATION,
  forgetConversation,
  getDesign,
  getHistory,
  hasConversation,
  oneTurnAtATime,
  rememberDesign,
  resetConversation,
} from "./conversations";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("oneTurnAtATime", () => {
  it("starts a conversation's next turn only after the previous one ends", async () => {
    const order: string[] = [];
    const first = deferred();
    const a = oneTurnAtATime("c1", async () => {
      order.push("first starts");
      await first.promise;
      order.push("first ends");
    });
    const b = oneTurnAtATime("c1", async () => {
      order.push("second starts");
    });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(order, ["first starts"]);

    first.resolve();
    await Promise.all([a, b]);
    assert.deepEqual(order, ["first starts", "first ends", "second starts"]);
  });

  it("still runs the next turn when the previous one failed, and reports each failure to its own caller", async () => {
    const failing = oneTurnAtATime("c2", async () => {
      throw new Error("boom");
    });
    let ran = false;
    const next = oneTurnAtATime("c2", async () => {
      ran = true;
    });
    await assert.rejects(failing, /boom/);
    await next;
    assert.equal(ran, true);
  });

  it("doesn't make different conversations wait for each other", async () => {
    const blocked = deferred();
    const slow = oneTurnAtATime("c3", () => blocked.promise);
    let otherRan = false;
    await oneTurnAtATime("c4", async () => {
      otherRan = true;
    });
    assert.equal(otherRan, true);
    blocked.resolve();
    await slow;
  });
});

describe("getHistory", () => {
  it("forgets the least recently used conversation past MAX_CONVERSATIONS", () => {
    const ids = Array.from({ length: MAX_CONVERSATIONS }, (_, i) => `lru-${i}`);
    for (const id of ids) getHistory(id).push({ role: "user", content: id });

    // Touch the oldest so the second oldest becomes least recently used.
    assert.deepEqual(getHistory("lru-0"), [{ role: "user", content: "lru-0" }]);
    getHistory("lru-new");

    assert.equal(hasConversation("lru-0"), true);
    assert.equal(hasConversation("lru-1"), false);
    assert.equal(hasConversation("lru-new"), true);
    assert.equal(hasConversation(`lru-${MAX_CONVERSATIONS - 1}`), true);

    for (const id of [...ids, "lru-new"]) resetConversation(id);
  });
});

describe("rememberDesign and getDesign", () => {
  const design = (n: number): UiNode => ({ component: "Card", props: { title: `design ${n}` } });

  it("keeps the last five designs and evicts the oldest", () => {
    assert.equal(MAX_DESIGNS_PER_CONVERSATION, 5);
    for (let n = 1; n <= 5; n++) rememberDesign("designs", `ui-${n}`, design(n));
    for (let n = 1; n <= 5; n++) assert.deepEqual(getDesign("designs", `ui-${n}`), design(n));

    rememberDesign("designs", "ui-6", design(6));
    assert.equal(getDesign("designs", "ui-1"), undefined);
    for (let n = 2; n <= 6; n++) assert.deepEqual(getDesign("designs", `ui-${n}`), design(n));

    resetConversation("designs");
  });

  it("returns undefined for unknown ids and unknown conversations, without creating them", () => {
    rememberDesign("known", "ui-1", design(1));
    assert.equal(getDesign("known", "ui-other"), undefined);
    assert.equal(getDesign("unknown", "ui-1"), undefined);
    assert.equal(hasConversation("unknown"), false);
    resetConversation("known");
  });

  it("creates the conversation it remembers a design for, sharing its history", () => {
    rememberDesign("fresh", "ui-1", design(1));
    assert.equal(hasConversation("fresh"), true);
    assert.deepEqual(getHistory("fresh"), []);
    assert.deepEqual(getDesign("fresh", "ui-1"), design(1));
    resetConversation("fresh");
  });

  it("drops a conversation's designs on reset", () => {
    rememberDesign("reset-me", "ui-1", design(1));
    resetConversation("reset-me");
    assert.equal(getDesign("reset-me", "ui-1"), undefined);
  });

  it("drops a conversation's designs when LRU forgets it, and getDesign doesn't count as a use", () => {
    rememberDesign("evict-0", "ui-1", design(1));
    const others = Array.from({ length: MAX_CONVERSATIONS - 1 }, (_, i) => `evict-${i + 1}`);
    for (const id of others) getHistory(id);

    // A read leaves evict-0 least recently used, so the next new one evicts it.
    assert.deepEqual(getDesign("evict-0", "ui-1"), design(1));
    getHistory("evict-new");

    assert.equal(hasConversation("evict-0"), false);
    assert.equal(getDesign("evict-0", "ui-1"), undefined);

    for (const id of [...others, "evict-new"]) resetConversation(id);
  });
});

describe("forgetConversation", () => {
  const design = (n: number): UiNode => ({ component: "Card", props: { title: `design ${n}` } });

  it("removes history and designs and leaves other conversations alone", async () => {
    getHistory("forget-a").push({ role: "user", content: "hi" });
    rememberDesign("forget-a", "ui-1", design(1));
    rememberDesign("forget-b", "ui-1", design(2));
    await forgetConversation("forget-a");
    assert.equal(hasConversation("forget-a"), false);
    assert.equal(getDesign("forget-a", "ui-1"), undefined);
    assert.deepEqual(getDesign("forget-b", "ui-1"), design(2));
    await forgetConversation("forget-never-existed");
    resetConversation("forget-b");
  });

  it("waits for a queued turn, so its late design does not survive", async () => {
    const gate = deferred();
    const turn = oneTurnAtATime("forget-c", async () => {
      await gate.promise;
      rememberDesign("forget-c", "ui-late", design(3));
    });
    const forgotten = forgetConversation("forget-c");
    gate.resolve();
    await turn;
    await forgotten;
    assert.equal(hasConversation("forget-c"), false);
    assert.equal(getDesign("forget-c", "ui-late"), undefined);
  });
});
