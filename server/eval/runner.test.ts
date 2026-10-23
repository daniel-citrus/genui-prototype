import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type { CustomComponentDefinition } from "shared/customComponents";
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
    assert.equal(result.trace.endedBy, "reply");
    assert.equal(result.trace.userText, headingCase.prompt);
    assert.match(result.trace.conversationId, /^eval:heading-test:/);
    const toolNames = result.trace.completions.flatMap((c) =>
      c.toolCalls.map((tc) => tc.call.name),
    );
    assert(toolNames.includes("render_ui"));
  });

  it("fails checks without throwing when the model only replies with text", async () => {
    const llm = scriptedLlm([{ content: "Here is a heading.", toolCalls: [] }]);

    const result = await runEvalCase(headingCase, { llm });

    assert.equal(result.ok, false);
    assert.equal(result.failures.length, 2);
    assert.match(result.failures[0]!.reason, /toolSucceeded "render_ui"/);
    assert.match(result.failures[1]!.reason, /uiComponent "Heading"/);
    assert.equal(result.endedBy, "reply");
    assert.equal(result.trace.endedBy, "reply");
    assert.match(result.trace.conversationId, /^eval:heading-test:/);
    const hasRenderUi = result.trace.completions.some((c) =>
      c.toolCalls.some((tc) => tc.call.name === "render_ui"),
    );
    assert.equal(hasRenderUi, false);
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

  describe("customComponents seeds", () => {
    const seed: CustomComponentDefinition = {
      name: "SeedCard",
      description: "A card with a heading.",
      category: "display",
      children: "none",
      propsSchema: {
        type: "object",
        properties: { title: { type: "string", description: "Heading text." } },
        required: ["title"],
        additionalProperties: false,
      },
      exampleProps: { title: "Hi" },
      template: {
        component: "Card",
        props: {},
        children: [{ component: "Heading", props: { text: { $prop: "title" } } }],
      },
    };
    const seeded: EvalCase = {
      id: "seeded",
      prompt: "Show it",
      checks: [{ toolSucceeded: "render_ui" }, { agentComponent: "SeedCard" }, { uiText: "Hello" }],
      customComponents: [seed],
    };

    it("lists and renders a seeded component", async () => {
      const tree = { component: "SeedCard", props: { title: "Hello" } };
      const llm = scriptedLlm([
        { content: null, toolCalls: [{ id: "l", name: "list_components", arguments: "{}" }] },
        {
          content: null,
          toolCalls: [{ id: "u", name: "render_ui", arguments: JSON.stringify({ tree }) }],
        },
        { content: "Done.", toolCalls: [] },
      ]);

      const result = await runEvalCase(seeded, { llm });

      const listed = result.trace.completions
        .flatMap((c) => c.toolCalls)
        .find((tc) => tc.call.name === "list_components");
      assert.match(JSON.stringify(listed), /SeedCard/);
      assert.equal(result.ok, true, JSON.stringify(result.failures));
    });

    it("fails an invalid seed without running the model", async () => {
      const llm = scriptedLlm([{ content: "never", toolCalls: [] }]);
      const bad = { ...seed, description: "" };

      const result = await runEvalCase({ ...seeded, customComponents: [bad] }, { llm });

      assert.equal(result.ok, false);
      assert.equal(result.error, "seed SeedCard: description must not be empty");
      assert.equal(llm.calls.length, 0);
    });
  });
});
