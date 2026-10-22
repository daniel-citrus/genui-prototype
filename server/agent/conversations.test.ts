import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UiNode } from "shared/ui";
import {
  MAX_CONVERSATIONS,
  MAX_DESIGNS_PER_CONVERSATION,
  MAX_TRACES_PER_CONVERSATION,
  getDesign,
  getHistory,
  getTraces,
  hasConversation,
  oneTurnAtATime,
  rememberDesign,
  rememberTrace,
  resetConversation,
} from "./conversations";
import type { AgentTrace } from "./trace";

function trace(conversationId: string, userText: string): AgentTrace {
  return {
    conversationId,
    userText,
    endedBy: "reply",
    steps: 1,
    toolCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    completions: [],
  };
}

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

describe("rememberTrace and getTraces", () => {
  it("returns empty for unknown ids without creating a conversation", () => {
    assert.deepEqual(getTraces("unknown-traces"), []);
    assert.equal(hasConversation("unknown-traces"), false);
  });

  it("returns empty for a conversation created only via getHistory", () => {
    getHistory("history-only");
    assert.deepEqual(getTraces("history-only"), []);
    resetConversation("history-only");
  });

  it("keeps the last five traces and evicts the oldest", () => {
    assert.equal(MAX_TRACES_PER_CONVERSATION, 5);
    for (let n = 1; n <= 5; n++) rememberTrace("traces", trace("traces", `turn-${n}`));
    assert.deepEqual(
      getTraces("traces").map((t) => t.userText),
      ["turn-1", "turn-2", "turn-3", "turn-4", "turn-5"],
    );

    rememberTrace("traces", trace("traces", "turn-6"));
    assert.deepEqual(
      getTraces("traces").map((t) => t.userText),
      ["turn-2", "turn-3", "turn-4", "turn-5", "turn-6"],
    );

    resetConversation("traces");
  });

  it("drops traces on reset", () => {
    rememberTrace("reset-traces", trace("reset-traces", "once"));
    resetConversation("reset-traces");
    assert.deepEqual(getTraces("reset-traces"), []);
  });

  it("drops traces when LRU forgets the conversation, and getTraces doesn't count as a use", () => {
    rememberTrace("trace-evict-0", trace("trace-evict-0", "only"));
    const others = Array.from({ length: MAX_CONVERSATIONS - 1 }, (_, i) => `trace-evict-${i + 1}`);
    for (const id of others) getHistory(id);

    assert.deepEqual(getTraces("trace-evict-0").map((t) => t.userText), ["only"]);
    getHistory("trace-evict-new");

    assert.equal(hasConversation("trace-evict-0"), false);
    assert.deepEqual(getTraces("trace-evict-0"), []);

    for (const id of [...others, "trace-evict-new"]) resetConversation(id);
  });
});
