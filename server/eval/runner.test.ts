import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomComponentDefinition } from "shared/customComponents";
import type { ComponentLlm, LlmMessage, LlmReply } from "../ports/ComponentLlm";
import { runEvalCase } from "./runner";
import type { EvalCase } from "./types";

const headingCase: EvalCase = {
  id: "heading-test",
  prompt: "Show a heading that says Hello",
  checks: [{ uiComponent: "Heading" }, { uiText: "Hello" }, { maxAttempts: 1 }],
};

const design = (tree: unknown) => JSON.stringify({ tree, notes: "Done." });
const heading = { component: "Heading", props: { text: "Hello", level: 1 } };

function scripted(replies: (string | Error)[]) {
  const calls: LlmMessage[][] = [];
  const llm: ComponentLlm = {
    async complete({ messages }): Promise<LlmReply> {
      calls.push(structuredClone(messages));
      const next = replies[Math.min(calls.length - 1, replies.length - 1)]!;
      if (next instanceof Error) throw next;
      return { content: next, truncated: false };
    },
  };
  return { llm, calls };
}

describe("runEvalCase", () => {
  it("is ok for a passing design and keeps the generation", async () => {
    const { llm } = scripted([design(heading)]);
    const result = await runEvalCase(headingCase, { llm });
    assert.equal(result.ok, true);
    assert.deepEqual(result.failures, []);
    assert.ok(result.generation?.ok);
    assert.equal(result.error, undefined);
  });

  it("fails the failing checks of a valid design", async () => {
    const { llm } = scripted([design({ component: "Text", props: { text: "Hi" } })]);
    const result = await runEvalCase(headingCase, { llm });
    assert.equal(result.ok, false);
    assert.deepEqual(result.failures.map((f) => f.check), [{ uiComponent: "Heading" }, { uiText: "Hello" }]);
  });

  it("fails a maxAttempts check when a repair was needed", async () => {
    const { llm, calls } = scripted([design({ component: "Nope" }), design(heading)]);
    const result = await runEvalCase(headingCase, { llm });
    assert.equal(calls.length, 2);
    assert.equal(result.ok, false);
    assert.deepEqual(result.failures.map((f) => f.check), [{ maxAttempts: 1 }]);
  });

  it("fails with the problem count when generation gives up", async () => {
    const { llm } = scripted(["not json"]);
    const result = await runEvalCase(headingCase, { llm });
    assert.equal(result.ok, false);
    assert.deepEqual(result.failures, [{ reason: "generation failed: 1 problems" }]);
    assert.equal(result.generation?.ok, false);
    assert.equal(result.generation?.attempts.length, 3);
  });

  it("fails with the error name when generation rejects", async () => {
    const { llm } = scripted([new TypeError("boom")]);
    const result = await runEvalCase(headingCase, { llm });
    assert.equal(result.ok, false);
    assert.deepEqual(result.failures, [{ reason: "generation error: TypeError" }]);
    assert.equal(result.error, "generation error: TypeError");
    assert.equal(result.generation, undefined);
  });

  it("reports an abort as a generation error", async () => {
    const { llm } = scripted([design(heading)]);
    const controller = new AbortController();
    controller.abort();
    const result = await runEvalCase(headingCase, { llm, signal: controller.signal });
    assert.deepEqual(result.failures, [{ reason: "generation error: AbortError" }]);
  });

  const seed: CustomComponentDefinition = {
    name: "Tag",
    description: "A tag.",
    category: "display",
    children: "none",
    propsSchema: { type: "object", properties: { text: { type: "string", description: "Text." } }, required: ["text"], additionalProperties: false },
    exampleProps: { text: "A" },
    template: { component: "Text", props: { text: { $prop: "text" } } },
  };

  it("seeds custom components so the design can use them", async () => {
    const { llm, calls } = scripted([design({ component: "Tag", props: { text: "Pinned" } })]);
    const evalCase: EvalCase = {
      id: "seeded",
      prompt: "Show a tag",
      checks: [{ agentComponent: "Tag" }, { uiText: "Pinned" }],
      customComponents: [seed],
    };
    const result = await runEvalCase(evalCase, { llm });
    assert.deepEqual(result.failures, []);
    assert.ok(calls[0]!.some((m) => m.content.includes("Tag")));
  });

  it("fails without calling the model when a seed is invalid", async () => {
    const { llm, calls } = scripted([design(heading)]);
    const evalCase: EvalCase = { ...headingCase, customComponents: [{ ...seed, template: { component: "Missing" } }] };
    const result = await runEvalCase(evalCase, { llm });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /^seed Tag: /);
    assert.equal(calls.length, 0);
  });
});
