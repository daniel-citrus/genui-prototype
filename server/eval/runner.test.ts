import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomComponentDefinition } from "shared/customComponents";
import { categories } from "../adapters/pos/fixtures";
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
    assert.deepEqual(result.attempts, []);
  });

  it("keeps the attempts made before a repair call rejects", async () => {
    const { llm } = scripted([design({ component: "Nope" }), new TypeError("boom")]);
    const result = await runEvalCase(headingCase, { llm });
    assert.equal(result.error, "generation error: TypeError");
    assert.ok(result.attempts);
    assert.equal(result.attempts.length, 1);
    assert.ok(result.attempts[0]!.problems.length > 0);
  });

  it("keeps the attempts made before an abort during a repair", async () => {
    const controller = new AbortController();
    const { llm, calls } = scripted([design({ component: "Nope" })]);
    const aborting: ComponentLlm = {
      async complete(input) {
        const reply = await llm.complete(input);
        controller.abort();
        return reply;
      },
    };
    const result = await runEvalCase(headingCase, { llm: aborting, signal: controller.signal });
    assert.deepEqual(result.failures, [{ reason: "generation error: AbortError" }]);
    assert.equal(calls.length, 1);
    assert.ok(result.attempts);
    assert.equal(result.attempts.length, 1);
    assert.ok(result.attempts[0]!.problems.length > 0);
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

  it("lets a seed use one saved before it", async () => {
    const pill: CustomComponentDefinition = {
      ...seed,
      name: "Pill",
      propsSchema: { type: "object", properties: { label: { type: "string", description: "Label." } }, required: ["label"], additionalProperties: false },
      exampleProps: { label: "A" },
      template: { component: "Tag", props: { text: { $prop: "label" } } },
    };
    const { llm } = scripted([design({ component: "Pill", props: { label: "New" } })]);
    const evalCase: EvalCase = { id: "nested", prompt: "Show a pill", checks: [{ uiText: "New" }], customComponents: [seed, pill] };
    const result = await runEvalCase(evalCase, { llm });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.failures, []);
  });

  it("starts each case without the components an earlier case saved", async () => {
    const usesTag = design({ component: "Tag", props: { text: "Pinned" } });
    const seeded: EvalCase = { id: "seeded", prompt: "Show a tag", checks: [{ uiText: "Pinned" }], customComponents: [seed] };
    assert.equal((await runEvalCase(seeded, { llm: scripted([usesTag]).llm })).ok, true);
    const result = await runEvalCase({ ...seeded, customComponents: undefined }, { llm: scripted([usesTag]).llm });
    assert.equal(result.ok, false);
    assert.equal(result.generation?.ok, false);
  });

  it("shows the model the menu actions and the menu's current dropdown values", async () => {
    const { llm, calls } = scripted([design(heading)]);
    await runEvalCase(headingCase, { llm });
    const context = calls[0]!.map((m) => m.content).join("\n");
    assert.ok(context.includes("menu_create_item"));
    assert.ok(context.includes(categories[0]!.name));
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
