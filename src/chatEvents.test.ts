import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEvent } from "shared/api";
import { threadEffect, thinkingAfter } from "./chatEvents";

const call = { id: "c1", name: "render_ui", args: {} };
const events: Record<AgentEvent["type"], AgentEvent> = {
  text: { type: "text", text: "hi" },
  tool_call: { type: "tool_call", call },
  tool_result: { type: "tool_result", call, result: { ok: true, summary: "ok" } },
  ui: { type: "ui", id: "u1", tree: { component: "Stack" } },
  notice: { type: "notice", message: "cut off" },
  done: { type: "done" },
  error: { type: "error", message: "boom" },
};

describe("threadEffect", () => {
  const expected = {
    text: "text",
    tool_call: null,
    tool_result: null,
    ui: null,
    notice: "notice",
    done: null,
    error: "error",
  };
  for (const [type, event] of Object.entries(events)) {
    it(`maps ${type}`, () => {
      assert.equal(threadEffect(event), expected[type as AgentEvent["type"]]);
    });
  }
});

describe("thinkingAfter", () => {
  const afterEvent = {
    text: [false, false],
    tool_call: [true, true],
    tool_result: [false, true],
    ui: [false, true],
    notice: [false, true],
    done: [false, false],
    error: [false, false],
  };
  for (const [type, event] of Object.entries(events)) {
    const [fromHidden, fromShown] = afterEvent[type as AgentEvent["type"]];
    it(`handles ${type}`, () => {
      assert.equal(thinkingAfter(false, event), fromHidden);
      assert.equal(thinkingAfter(true, event), fromShown);
    });
  }

  it("shows, hides and shows again across text → tool_call → text", () => {
    let thinking = true;
    const seen: boolean[] = [];
    for (const type of ["text", "tool_call", "tool_result", "text"] as const) {
      thinking = thinkingAfter(thinking, events[type]);
      seen.push(thinking);
    }
    assert.deepEqual(seen, [false, true, true, false]);
  });
});
