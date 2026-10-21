import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalog } from "../catalog/components";
import { InMemoryComponentRepository } from "../ports/fakes/InMemoryComponentRepository";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { createAgentTools } from "./tools/index";

const toolNames = createAgentTools({
  components: new InMemoryComponentRepository(catalog),
}).map((t) => t.name);

describe("SYSTEM_PROMPT", () => {
  it("mentions every registered tool", () => {
    for (const name of toolNames) {
      assert.ok(SYSTEM_PROMPT.includes(name), `prompt does not mention tool ${name}`);
    }
  });

  it("names only registered tools in snake_case", () => {
    const words = SYSTEM_PROMPT.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [];
    for (const word of words) {
      assert.ok(toolNames.includes(word), `prompt mentions unknown tool ${word}`);
    }
  });

  it("tells the agent how to attach actions", () => {
    assert.ok(toolNames.includes("list_actions"));
    assert.match(SYSTEM_PROMPT, /call list_actions/);
    assert.match(SYSTEM_PROMPT, /won't do anything yet/);
    assert.doesNotMatch(SYSTEM_PROMPT, /nothing the person types/);
  });

  it("finds the action before choosing components", () => {
    const call = SYSTEM_PROMPT.indexOf("call list_actions");
    const choose = SYSTEM_PROMPT.indexOf("Choose the components you need");
    assert.ok(call >= 0 && choose >= 0);
    assert.ok(call < choose, "list_actions comes after choosing components");
    assert.ok(
      SYSTEM_PROMPT.includes(
        "call list_actions with the area and operation that fit what the button should do (any when unsure), and build the form around the returned inputs and choices",
      ),
    );
  });

  it("names the cases that don't need list_actions", () => {
    assert.ok(
      SYSTEM_PROMPT.includes(
        "Don't call list_actions when no button needs the server: a design without buttons, buttons that only move around the design (Cancel, Back, Close, Next), questions about the catalog, changes that leave a design's buttons alone, or a design the person calls a mockup.",
      ),
    );
  });

  it("explains others, choices, optional properties and confirmation", () => {
    for (const sentence of [
      "If the action you need is listed under others, call list_actions again with that action's area and operation.",
      "If no action fits, render the button without an action",
      "For an input that has choices, use a Select named after the input, with that source's values as its options.",
      "Besides every required property, give an input to each optional property the request mentions or implies; a form that edits something needs at least one field to change.",
      "If the action has a confirm question, the person is asked it before the action runs, so say so in the reply.",
    ]) {
      assert.ok(SYSTEM_PROMPT.includes(sentence), `prompt is missing: ${sentence}`);
    }
  });
});
