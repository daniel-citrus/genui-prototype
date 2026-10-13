import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTurnAccumulator,
  parseToolArguments,
  toOpenAITools,
} from "./openaiTools";
import type { ToolSpec } from "./tools";

const toolSpecs: ToolSpec[] = [
  {
    name: "list_components",
    description: "List every saved component.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "rename_component",
    description: "Rename a component.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" } },
      required: ["id", "name"],
    },
  },
];

describe("toOpenAITools", () => {
  it("maps each tool to an OpenAI function tool with the same schema", () => {
    const tools = toOpenAITools(toolSpecs);
    assert.equal(tools.length, toolSpecs.length);

    const rename = tools.find((t) => t.function.name === "rename_component");
    const spec = toolSpecs.find((t) => t.name === "rename_component");
    assert.ok(rename);
    assert.ok(spec);
    assert.equal(rename.type, "function");
    assert.equal(rename.function.description, spec.description);
    assert.deepEqual(rename.function.parameters, spec.input_schema);
  });
});

describe("parseToolArguments", () => {
  it("parses a JSON object string", () => {
    assert.deepEqual(parseToolArguments('{"id":"c1","name":"Thẻ giá"}'), {
      id: "c1",
      name: "Thẻ giá",
    });
  });

  it("returns an empty object for blank or invalid JSON", () => {
    assert.deepEqual(parseToolArguments(""), {});
    assert.deepEqual(parseToolArguments("   "), {});
    assert.deepEqual(parseToolArguments("{"), {});
    assert.deepEqual(parseToolArguments("[]"), {});
    assert.deepEqual(parseToolArguments('"just a string"'), {});
  });
});

describe("createTurnAccumulator", () => {
  it("concatenates streamed text and merges fragmented tool calls by index", () => {
    const turn = createTurnAccumulator();
    turn.apply({ content: "Looking " });
    turn.apply({ content: "now." });
    turn.apply({
      tool_calls: [{ index: 0, id: "call_1", function: { name: "rename_" } }],
    });
    turn.apply({
      tool_calls: [{ index: 0, function: { name: "component", arguments: '{"id"' } }],
    });
    turn.apply({
      tool_calls: [{ index: 0, function: { arguments: ':"c1"}' } }],
    });
    turn.apply({
      tool_calls: [
        { index: 1, id: "call_2", function: { name: "list_components", arguments: "{}" } },
      ],
    });

    assert.deepEqual(turn.finish(), {
      content: "Looking now.",
      toolCalls: [
        { id: "call_1", name: "rename_component", arguments: '{"id":"c1"}' },
        { id: "call_2", name: "list_components", arguments: "{}" },
      ],
    });
  });
});
