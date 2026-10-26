import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalog } from "../catalog/components";
import type { ComponentLlm, LlmMessage, LlmReply } from "../ports/ComponentLlm";
import { InMemoryComponentRepository } from "../ports/fakes/InMemoryComponentRepository";
import { generateComponent, MAX_ATTEMPTS, MAX_NOTES_CHARS, type GenerateDeps } from "./generate";

const components = new InMemoryComponentRepository(catalog);

const heading = { component: "Heading", props: { text: "Hello", level: 1 } };
const good = JSON.stringify({ tree: heading, notes: "  All set.  " });
const badDesign = JSON.stringify({ tree: { component: "Nope" }, notes: "" });

/** A fake model that plays `replies` in order and records the messages of each call. */
function scripted(replies: (string | Partial<LlmReply> | Error)[]) {
  const calls: LlmMessage[][] = [];
  const llm: ComponentLlm = {
    async complete({ messages }) {
      calls.push(structuredClone(messages));
      const next = replies[calls.length - 1];
      if (next === undefined) throw new Error("no more scripted replies");
      if (next instanceof Error) throw next;
      if (typeof next === "string") return { content: next, truncated: false };
      return { content: null, truncated: false, ...next };
    },
  };
  return { llm, calls };
}

function deps(llm: ComponentLlm, over: Partial<GenerateDeps> = {}): GenerateDeps {
  return {
    llm,
    components,
    actions: [],
    log: { info() {}, debug() {}, warn() {}, error() {} },
    signal: new AbortController().signal,
    ...over,
  };
}

describe("generateComponent", () => {
  it("succeeds with one call when the first design is valid", async () => {
    const { llm, calls } = scripted([{ content: good, usage: { promptTokens: 5, completionTokens: 2 } }]);
    const result = await generateComponent("say hello", deps(llm));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.at(-1)!.content, "say hello");
    assert.ok(result.ok);
    assert.deepEqual(result.tree, heading);
    assert.equal(result.notes, "All set.");
    assert.equal(result.attempts.length, 1);
    assert.deepEqual(result.attempts[0]!.tree, heading);
    assert.deepEqual(result.attempts[0]!.usage, { promptTokens: 5, completionTokens: 2 });
  });

  it("repairs a reply that isn't JSON", async () => {
    const { llm, calls } = scripted(["not json", good]);
    const result = await generateComponent("x", deps(llm));
    assert.ok(result.ok);
    assert.equal(result.attempts.length, 2);
    assert.deepEqual(result.attempts[0]!.problems, ['Reply was not a JSON object with "tree" and "notes"']);
    const repair = calls[1]!.slice(-2);
    assert.deepEqual(repair[0], { role: "assistant", content: "not json" });
    assert.equal(repair[1]!.role, "user");
    assert.match(repair[1]!.content, /Reply was not a JSON object/);
  });

  it("refuses a reply without a tree object or with non-string notes", async () => {
    for (const reply of ['{"notes":""}', '{"tree":[],"notes":""}', '{"tree":{"component":"Stack"},"notes":3}', "[]"]) {
      const { llm } = scripted([reply, good]);
      const result = await generateComponent("x", deps(llm));
      assert.ok(result.ok);
      assert.match(result.attempts[0]!.problems[0]!, /"tree" and "notes"/);
    }
  });

  it("treats a cut-off reply as failed and asks for a smaller design", async () => {
    const { llm } = scripted([{ content: good, truncated: true }, good]);
    const result = await generateComponent("x", deps(llm));
    assert.ok(result.ok);
    assert.equal(result.attempts[0]!.truncated, true);
    assert.equal(result.attempts[0]!.tree, undefined);
    assert.equal(result.attempts[0]!.problems[1], "Reply was cut off; make the design smaller");
  });

  it("succeeds on the third attempt after two bad designs", async () => {
    const { llm, calls } = scripted([badDesign, badDesign, good]);
    const result = await generateComponent("x", deps(llm));
    assert.ok(result.ok);
    assert.equal(result.attempts.length, 3);
    assert.equal(calls.length, 3);
    assert.ok(result.attempts[0]!.problems.length > 0);
    assert.equal(calls[2]!.length, calls[0]!.length + 4);
  });

  it("gives up after three bad designs without a fourth call", async () => {
    const { llm, calls } = scripted([badDesign, badDesign, badDesign, good]);
    const result = await generateComponent("x", deps(llm));
    assert.equal(result.ok, false);
    assert.equal(calls.length, MAX_ATTEMPTS);
    assert.equal(result.attempts.length, 3);
    assert.deepEqual(result.problems, result.attempts[2]!.problems);
    assert.ok(result.problems.length > 0);
  });

  it("cuts notes to 500 characters", async () => {
    const reply = JSON.stringify({ tree: heading, notes: ` ${"n".repeat(600)} ` });
    const result = await generateComponent("x", deps(scripted([reply]).llm));
    assert.ok(result.ok);
    assert.equal(result.notes.length, MAX_NOTES_CHARS);
  });

  it("allows empty notes", async () => {
    const result = await generateComponent("x", deps(scripted([JSON.stringify({ tree: heading, notes: "" })]).llm));
    assert.ok(result.ok);
    assert.equal(result.notes, "");
  });

  it("rejects with an AbortError, making no further call, when aborted before a repair", async () => {
    const controller = new AbortController();
    const { llm, calls } = scripted([badDesign, good]);
    const aborting: ComponentLlm = {
      async complete(input) {
        const reply = await llm.complete(input);
        controller.abort();
        return reply;
      },
    };
    await assert.rejects(generateComponent("x", deps(aborting, { signal: controller.signal })), { name: "AbortError" });
    assert.equal(calls.length, 1);
  });

  it("rejects when the model call fails", async () => {
    await assert.rejects(generateComponent("x", deps(scripted([new Error("503")]).llm)), /503/);
  });

  it("rejects when the catalog can't be read", async () => {
    const broken = { ...components, list: async () => Promise.reject(new Error("db")) } as unknown as GenerateDeps["components"];
    await assert.rejects(generateComponent("x", deps(scripted([good]).llm, { components: broken })), /db/);
  });
});
