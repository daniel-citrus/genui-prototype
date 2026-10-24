import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEvent } from "shared/api";
import { catalog } from "../catalog/components";
import { InMemoryComponentRepository } from "../ports/fakes/InMemoryComponentRepository";
import { InMemoryTraceRepository } from "../ports/fakes/InMemoryTraceRepository";
import { createDesignStore } from "../designs";
import { createToolRegistry } from "./registry";
import { handleToolCall, type AgentRun } from "./run";
import { createAgentTools } from "./tools/index";

function makeRun(): { run: AgentRun; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const run: AgentRun = {
    emit: (event) => void events.push(event),
    conversationId: "run-test",
    designs: createDesignStore({ max: 5 }),
    signal: new AbortController().signal,
    tools: createToolRegistry(createAgentTools({ components: new InMemoryComponentRepository(catalog) })),
    log: { info() {}, debug() {}, error() {}, warn() {} },
    traces: new InMemoryTraceRepository(),
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
    const ui = events[1];
    assert.ok(ui?.type === "ui");
    assert.match(ui.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual(ui, { type: "ui", id: ui.id, tree });
    assert.deepEqual(run.designs.get(ui.id), tree);
    assert.equal(outcome.isError, false);
  });

  it("gives each design its own id", async () => {
    const { run, events } = makeRun();
    const args = { tree: { component: "Divider" } };

    await handleToolCall(run, { id: "call_1", name: "render_ui", args });
    await handleToolCall(run, { id: "call_2", name: "render_ui", args });

    const ids = events.flatMap((e) => (e.type === "ui" ? [e.id] : []));
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
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
    assert.equal(outcome.retryable, true);
  });

  it("does not mark a successful render or an unknown tool retryable", async () => {
    const { run } = makeRun();
    const ok = await handleToolCall(run, { id: "c1", name: "render_ui", args: { tree: { component: "Divider" } } });
    const unknown = await handleToolCall(run, { id: "c2", name: "nope", args: {} });
    assert.equal(ok.retryable, false);
    assert.equal(unknown.isError, true);
    assert.equal(unknown.retryable, false);
  });
});
