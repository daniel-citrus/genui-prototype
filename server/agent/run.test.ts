import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEvent } from "shared/api";
import { catalog } from "../catalog/components";
import { InMemoryComponentRepository } from "../ports/fakes/InMemoryComponentRepository";
import { createToolRegistry } from "./registry";
import { handleToolCall, type AgentRun } from "./run";
import { createAgentTools } from "./tools/index";

function makeRun(): { run: AgentRun; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const run: AgentRun = {
    emit: (event) => void events.push(event),
    signal: new AbortController().signal,
    tools: createToolRegistry(createAgentTools({ components: new InMemoryComponentRepository(catalog) })),
    log: { debug() {}, error() {} },
  };
  return { run, events };
}

describe("handleToolCall with render_ui", () => {
  it("emits tool_call, ui, then tool_result for a valid tree", async () => {
    const { run, events } = makeRun();
    const tree = { component: "Card", props: { title: "Hi" }, children: [{ component: "Divider" }] };
    const call = { id: "call_1", name: "render_ui", args: { tree } };

    const outcome = await handleToolCall(run, call);

    assert.deepEqual(
      events.map((e) => e.type),
      ["tool_call", "ui", "tool_result"],
    );
    assert.deepEqual(events[1], { type: "ui", tree });
    assert.equal(outcome.isError, false);
  });

  it("emits no ui event for an invalid tree", async () => {
    const { run, events } = makeRun();
    const call = { id: "call_1", name: "render_ui", args: { tree: { component: "Nope" } } };

    const outcome = await handleToolCall(run, call);

    assert.deepEqual(
      events.map((e) => e.type),
      ["tool_call", "tool_result"],
    );
    assert.equal(outcome.isError, true);
  });
});
