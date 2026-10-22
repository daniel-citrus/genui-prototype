import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type { AgentLlm, LlmTurn } from "../ports/AgentLlm";
import type { ToolSpec } from "../agent/tools";
import { hasConversation } from "../agent/conversations";
import { evalRunnerTestHooks, runEvalCase } from "./runner";
import type { EvalCase } from "./types";

const headingCase: EvalCase = {
  id: "heading-test",
  prompt: "Show a heading that says Hello",
  checks: [{ toolSucceeded: "render_ui" }, { uiComponent: "Heading" }],
};

interface ScriptedLlm extends AgentLlm {
  calls: Array<{ messageCount: number; tools: ToolSpec[]; allowTools?: boolean }>;
}

function scriptedLlm(turns: LlmTurn[]): ScriptedLlm {
  const calls: ScriptedLlm["calls"] = [];
  return {
    calls,
    async complete({ messages, tools, allowTools, onText }) {
      calls.push({ messageCount: messages.length, tools, allowTools });
      const turn = turns[Math.min(calls.length - 1, turns.length - 1)];
      if (turn.content) onText(turn.content);
      return turn;
    },
  };
}

describe("runEvalCase", () => {
  it("passes when the model lists components and render_ui a Heading", async () => {
    const tree = { component: "Heading", props: { text: "Hello" } };
    const llm = scriptedLlm([
      {
        content: null,
        toolCalls: [{ id: "call_list", name: "list_components", arguments: "{}" }],
      },
      {
        content: null,
        toolCalls: [{ id: "call_ui", name: "render_ui", arguments: JSON.stringify({ tree }) }],
      },
      { content: "Done.", toolCalls: [] },
    ]);

    const result = await runEvalCase(headingCase, { llm });

    assert.equal(result.id, headingCase.id);
    assert.equal(result.ok, true);
    assert.deepEqual(result.failures, []);
    assert.equal(result.endedBy, "reply");
  });

  it("fails checks without throwing when the model only replies with text", async () => {
    const llm = scriptedLlm([{ content: "Here is a heading.", toolCalls: [] }]);

    const result = await runEvalCase(headingCase, { llm });

    assert.equal(result.ok, false);
    assert.equal(result.failures.length, 2);
    assert.match(result.failures[0]!.reason, /toolSucceeded "render_ui"/);
    assert.match(result.failures[1]!.reason, /uiComponent "Heading"/);
    assert.equal(result.endedBy, "reply");
  });

  it("clears the in-memory conversation after the case", async () => {
    const conversationId = "eval:heading-test:00000000-0000-4000-8000-000000000001";
    evalRunnerTestHooks.uuid = () => "00000000-0000-4000-8000-000000000001";
    try {
      const llm = scriptedLlm([{ content: "text only", toolCalls: [] }]);

      await runEvalCase(headingCase, { llm });

      assert.equal(hasConversation(conversationId), false);
    } finally {
      evalRunnerTestHooks.uuid = randomUUID;
    }
  });
});
