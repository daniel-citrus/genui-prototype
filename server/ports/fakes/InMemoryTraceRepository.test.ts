import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentTrace } from "../../agent/trace";
import { MAX_TRACES_PER_CONVERSATION } from "../TraceRepository";
import { InMemoryTraceRepository } from "./InMemoryTraceRepository";

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

describe("InMemoryTraceRepository", () => {
  it("returns saved traces oldest first", async () => {
    const repo = new InMemoryTraceRepository();
    await repo.save(trace("c1", "first"));
    await repo.save(trace("c1", "second"));
    await repo.save(trace("c1", "third"));
    assert.deepEqual(
      (await repo.listByConversation("c1")).map((t) => t.userText),
      ["first", "second", "third"],
    );
  });

  it(`drops the oldest trace after ${MAX_TRACES_PER_CONVERSATION} saves for one conversation`, async () => {
    const repo = new InMemoryTraceRepository();
    for (let i = 1; i <= MAX_TRACES_PER_CONVERSATION + 1; i++) {
      await repo.save(trace("c1", `t${i}`));
    }
    const texts = (await repo.listByConversation("c1")).map((t) => t.userText);
    assert.equal(texts.length, MAX_TRACES_PER_CONVERSATION);
    assert.deepEqual(texts, ["t2", "t3", "t4", "t5", "t6"]);
  });

  it("returns an empty list for an unknown conversation id", async () => {
    const repo = new InMemoryTraceRepository();
    assert.deepEqual(await repo.listByConversation("missing"), []);
  });

  it("isolates traces by conversation id", async () => {
    const repo = new InMemoryTraceRepository();
    await repo.save(trace("a", "only-a"));
    await repo.save(trace("b", "only-b"));
    assert.deepEqual(
      (await repo.listByConversation("a")).map((t) => t.userText),
      ["only-a"],
    );
    assert.deepEqual(
      (await repo.listByConversation("b")).map((t) => t.userText),
      ["only-b"],
    );
  });
});
