import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEvent, ToolResult } from "shared/api";
import type { AgentLlm, HistoryMessage, LlmTurn } from "../ports/AgentLlm";
import { catalog } from "../catalog/components";
import { InMemoryComponentRepository } from "../ports/fakes/InMemoryComponentRepository";
import { getHistory, resetConversation } from "./conversations";
import { FORGOTTEN_NOTICE, MAX_STEPS, runAgent } from "./loop";
import { createToolRegistry } from "./registry";
import type { AgentRun } from "./run";
import type { ToolContext, ToolLogger, ToolRegistry, ToolSpec } from "./tools";
import { createAgentTools } from "./tools/index";

const noopLogger: ToolLogger = { debug() {}, error() {} };

const specs: ToolSpec[] = [
  {
    name: "list_components",
    description: "List every saved component.",
    input_schema: { type: "object", properties: {} },
  },
];

interface ScriptedLlm extends AgentLlm {
  calls: Array<{ messageCount: number; tools: ToolSpec[] }>;
}

/** Returns `turns` in order (the last one repeats), streaming each turn's content. */
function scriptedLlm(turns: LlmTurn[]): ScriptedLlm {
  const calls: ScriptedLlm["calls"] = [];
  return {
    calls,
    async complete({ messages, tools, onText }) {
      calls.push({ messageCount: messages.length, tools });
      const turn = turns[Math.min(calls.length - 1, turns.length - 1)];
      if (turn.content) onText(turn.content);
      return turn;
    },
  };
}

function stubTools(): ToolRegistry & {
  ran: Array<{ name: string; args: Record<string, unknown> }>;
  contexts: ToolContext[];
} {
  const ran: Array<{ name: string; args: Record<string, unknown> }> = [];
  const contexts: ToolContext[] = [];
  return {
    ran,
    contexts,
    specs,
    async run(name, args, ctx): Promise<ToolResult> {
      ran.push({ name, args });
      contexts.push(ctx);
      return { ok: true, summary: `ran ${name}`, data: args };
    },
  };
}

function makeRun(
  tools: ToolRegistry,
  opts: { signal?: AbortSignal; resume?: boolean } = {},
): { run: AgentRun; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const run: AgentRun = {
    emit: (event) => {
      events.push(event);
    },
    signal: opts.signal ?? new AbortController().signal,
    tools,
    log: noopLogger,
    resume: opts.resume,
  };
  return { run, events };
}

describe("runAgent", () => {
  it("streams text and stops when the model makes no tool calls", async () => {
    const conversationId = "text-only";
    const { run, events } = makeRun(stubTools());
    const llm = scriptedLlm([{ content: "Hello there.", toolCalls: [] }]);

    await runAgent("hi", conversationId, run, llm);
    const history = getHistory(conversationId);
    resetConversation(conversationId);

    assert.deepEqual(events, [{ type: "text", text: "Hello there." }]);
    assert.deepEqual(history, [
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello there." },
    ]);
    assert.equal(history.filter((m) => m.role === "assistant").length, 1);
  });

  it("runs a tool, feeds the result back, then finishes on the next turn", async () => {
    const conversationId = "tool-then-text";
    const tools = stubTools();
    const { run, events } = makeRun(tools);
    const llm = scriptedLlm([
      {
        content: null,
        toolCalls: [{ id: "call_1", name: "list_components", arguments: '{"limit":3}' }],
      },
      { content: "Here are the components.", toolCalls: [] },
    ]);

    await runAgent("show the components", conversationId, run, llm);
    const history = getHistory(conversationId);
    resetConversation(conversationId);

    assert.deepEqual(
      llm.calls.map((c) => c.messageCount),
      [1, 3],
    );
    assert.deepEqual(llm.calls[0].tools, specs);
    assert.deepEqual(tools.ran, [{ name: "list_components", args: { limit: 3 } }]);
    assert.equal(tools.contexts.length, 1);
    assert.equal(tools.contexts[0].signal, run.signal);
    assert.equal(tools.contexts[0].log, run.log);
    assert.equal(typeof tools.contexts[0].showUi, "function");

    const call = { id: "call_1", name: "list_components", args: { limit: 3 } };
    assert.deepEqual(events, [
      { type: "tool_call", call },
      {
        type: "tool_result",
        call,
        result: { ok: true, summary: "ran list_components", data: { limit: 3 } },
      },
      { type: "text", text: "Here are the components." },
    ]);

    const toolRow = history.find(
      (m): m is Extract<HistoryMessage, { role: "tool" }> => m.role === "tool",
    );
    assert.ok(toolRow);
    assert.equal(toolRow.tool_call_id, "call_1");
    assert.deepEqual(JSON.parse(toolRow.content), {
      summary: "ran list_components",
      data: { limit: 3 },
    });
    const assistant = history[1];
    assert.equal(assistant.role, "assistant");
    assert.equal(assistant.tool_calls?.[0].id, "call_1");
  });

  it("looks up components with the real tools, then replies", async () => {
    const conversationId = "component-tools";
    const tools = createToolRegistry(
      createAgentTools({ components: new InMemoryComponentRepository(catalog) }),
    );
    const { run, events } = makeRun(tools);
    const llm = scriptedLlm([
      {
        content: null,
        toolCalls: [{ id: "call_list", name: "list_components", arguments: "{}" }],
      },
      {
        content: null,
        toolCalls: [{ id: "call_get", name: "get_component", arguments: '{"name":"Button"}' }],
      },
      { content: "Use a Button.", toolCalls: [] },
    ]);

    await runAgent("what components can I use?", conversationId, run, llm);
    const history = getHistory(conversationId);
    resetConversation(conversationId);

    assert.equal(llm.calls.length, 3);
    assert.deepEqual(
      llm.calls[0].tools.map((t) => t.name),
      ["list_components", "get_component", "render_ui"],
    );

    const listCall = { id: "call_list", name: "list_components", args: {} };
    const getCall = { id: "call_get", name: "get_component", args: { name: "Button" } };
    assert.deepEqual(
      events.map((e) => e.type),
      ["tool_call", "tool_result", "tool_call", "tool_result", "text"],
    );
    assert.deepEqual(events[0], { type: "tool_call", call: listCall });
    assert.deepEqual(events[2], { type: "tool_call", call: getCall });
    const [listResult, getResult] = [events[1], events[3]];
    assert.ok(listResult.type === "tool_result" && getResult.type === "tool_result");
    assert.deepEqual(listResult.call, listCall);
    assert.deepEqual(
      [listResult.result.ok, listResult.result.summary],
      [true, `Listed ${catalog.length} components`],
    );
    assert.deepEqual(getResult.call, getCall);
    assert.deepEqual([getResult.result.ok, getResult.result.summary], [true, "Read Button"]);
    assert.deepEqual(events[4], { type: "text", text: "Use a Button." });

    const toolRows = history.filter(
      (m): m is Extract<HistoryMessage, { role: "tool" }> => m.role === "tool",
    );
    assert.deepEqual(
      toolRows.map((m) => m.tool_call_id),
      ["call_list", "call_get"],
    );
    const listed = JSON.parse(toolRows[0].content);
    assert.equal(listed.data.components.length, catalog.length);
    const read = JSON.parse(toolRows[1].content);
    assert.equal(read.summary, "Read Button");
    assert.deepEqual(
      read.data.propsSchema,
      catalog.find((c) => c.name === "Button")!.propsSchema,
    );
    assert.deepEqual(history.at(-1), { role: "assistant", content: "Use a Button." });
  });

  it("emits an error after MAX_STEPS tool-use steps", async () => {
    const conversationId = "too-many-steps";
    const { run, events } = makeRun(stubTools());
    const llm = scriptedLlm([
      {
        content: null,
        toolCalls: [{ id: "call_x", name: "list_components", arguments: "{}" }],
      },
    ]);

    await runAgent("keep going", conversationId, run, llm);
    resetConversation(conversationId);

    assert.equal(llm.calls.length, MAX_STEPS);
    const error = events.find((e) => e.type === "error");
    assert.ok(error);
    assert.match(error.message, /too many steps/i);
  });

  it("returns immediately when the run is already aborted", async () => {
    const conversationId = "aborted";
    const controller = new AbortController();
    controller.abort();
    const { run, events } = makeRun(stubTools(), { signal: controller.signal });
    const llm = scriptedLlm([{ content: "should not run", toolCalls: [] }]);

    await runAgent("hi", conversationId, run, llm);
    resetConversation(conversationId);

    assert.equal(llm.calls.length, 0);
    assert.deepEqual(events, []);
  });

  it("reports a tool as stopped, without running it, when the turn is aborted first", async () => {
    const conversationId = "stopped-before-tool";
    const controller = new AbortController();
    const tools = stubTools();
    const { run, events } = makeRun(tools, { signal: controller.signal });
    const llm: AgentLlm = {
      async complete() {
        // Stop arrives while the model is answering with a tool call.
        controller.abort();
        return {
          content: null,
          toolCalls: [{ id: "call_1", name: "list_components", arguments: "{}" }],
        };
      },
    };

    await runAgent("list", conversationId, run, llm);
    const history = getHistory(conversationId);
    resetConversation(conversationId);

    assert.deepEqual(tools.ran, []);
    const result = events.find((e) => e.type === "tool_result");
    assert.ok(result);
    assert.equal(result.result.ok, false);
    assert.equal(result.result.summary, "Stopped before this ran.");
    const toolRow = history.at(-1);
    assert.ok(toolRow && toolRow.role === "tool");
    assert.equal(toolRow.tool_call_id, "call_1");
    assert.match(toolRow.content, /stopped/);
  });

  it("says the earlier messages are gone when resuming an unknown conversation", async () => {
    const conversationId = "forgotten";
    resetConversation(conversationId);
    const { run, events } = makeRun(stubTools(), { resume: true });
    const llm = scriptedLlm([{ content: "Hi again.", toolCalls: [] }]);

    await runAgent("as I said", conversationId, run, llm);

    assert.deepEqual(events[0], { type: "notice", message: FORGOTTEN_NOTICE });

    // A known conversation gets no notice.
    const second = makeRun(stubTools(), { resume: true });
    await runAgent("and also", conversationId, second.run, llm);
    resetConversation(conversationId);
    assert.equal(second.events.some((e) => e.type === "notice"), false);
  });
});
