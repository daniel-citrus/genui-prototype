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
});
