import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_CONVERSATIONS,
  forgetConversation,
  getHistory,
  hasConversation,
  oneTurnAtATime,
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

describe("forgetConversation", () => {
  it("removes history and leaves other conversations alone", async () => {
    getHistory("forget-a").push({ role: "user", content: "hi" });
    getHistory("forget-b");
    await forgetConversation("forget-a");
    assert.equal(hasConversation("forget-a"), false);
    assert.equal(hasConversation("forget-b"), true);
    await forgetConversation("forget-never-existed");
    resetConversation("forget-b");
  });

  it("waits for a queued turn, so its late history does not survive", async () => {
    const gate = deferred();
    const turn = oneTurnAtATime("forget-c", async () => {
      await gate.promise;
      getHistory("forget-c");
    });
    const forgotten = forgetConversation("forget-c");
    gate.resolve();
    await turn;
    await forgotten;
    assert.equal(hasConversation("forget-c"), false);
  });
});
