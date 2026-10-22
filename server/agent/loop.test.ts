import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEvent, ToolResult } from "shared/api";
import type { AgentLlm, HistoryMessage, LlmTurn } from "../ports/AgentLlm";
import { catalog } from "../catalog/components";
import { InMemoryComponentRepository } from "../ports/fakes/InMemoryComponentRepository";
import { InMemoryCustomComponentRepository } from "../ports/fakes/InMemoryCustomComponentRepository";
import type { TraceRepository } from "../ports/TraceRepository";
import { InMemoryTraceRepository } from "../ports/fakes/InMemoryTraceRepository";
import { getDesign, getHistory, resetConversation } from "./conversations";
import { MAX_TOOL_CALLS_PER_TURN, MAX_TURN_TOKENS } from "./guardrails";
import { FORGOTTEN_NOTICE, MAX_STEPS, runAgent, TRUNCATED_NOTICE } from "./loop";
import { createToolRegistry } from "./registry";
import type { AgentRun } from "./run";
import type { ToolContext, ToolLogger, ToolRegistry, ToolSpec } from "./tools";
import { createAgentTools } from "./tools/index";

const noopLogger: ToolLogger = { debug() {}, error() {}, info() {}, warn() {} };

const specs: ToolSpec[] = [
  {
    name: "list_components",
    description: "List every saved component.",
    input_schema: { type: "object", properties: {} },
  },
];

interface ScriptedLlm extends AgentLlm {
  calls: Array<{ messageCount: number; tools: ToolSpec[]; allowTools?: boolean }>;
}

/** Returns `turns` in order (the last one repeats), streaming each turn's content. */
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
  opts: {
    conversationId?: string;
    signal?: AbortSignal;
    resume?: boolean;
    log?: ToolLogger;
    traces?: TraceRepository;
  } = {},
): { run: AgentRun; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const run: AgentRun = {
    emit: (event) => {
      events.push(event);
    },
    conversationId: opts.conversationId ?? "loop-test",
    signal: opts.signal ?? new AbortController().signal,
    tools,
    log: opts.log ?? noopLogger,
    traces: opts.traces ?? new InMemoryTraceRepository(),
    resume: opts.resume,
  };
  return { run, events };
}

function infoLog() {
  const infos: Array<Record<string, unknown>> = [];
  const log: ToolLogger = {
    ...noopLogger,
    info: (obj) => {
      infos.push(obj as Record<string, unknown>);
    },
  };
  return { log, infos };
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

  it("remembers a rendered design under its ui event id", async () => {
    const conversationId = "render-remembered";
    const tools = createToolRegistry(
      createAgentTools({ components: new InMemoryComponentRepository(catalog) }),
    );
    const { run, events } = makeRun(tools, { conversationId });
    const tree = { component: "Card", props: { title: "Hi" } };
    const llm = scriptedLlm([
      {
        content: null,
        toolCalls: [{ id: "call_ui", name: "render_ui", arguments: JSON.stringify({ tree }) }],
      },
      { content: "Done.", toolCalls: [] },
    ]);

    await runAgent("draw a card", conversationId, run, llm);
    const ui = events.find((e) => e.type === "ui");
    const remembered = ui?.type === "ui" ? getDesign(conversationId, ui.id) : undefined;
    resetConversation(conversationId);

    assert.ok(ui?.type === "ui");
    assert.deepEqual(remembered, tree);
  });

  it("looks up components with the real tools, then replies", async () => {
    const conversationId = "component-tools";
    const tools = createToolRegistry(
      createAgentTools({
        components: new InMemoryComponentRepository(catalog),
        customComponents: new InMemoryCustomComponentRepository(),
      }),
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
      ["list_components", "get_component", "list_actions", "render_ui", "define_component", "delete_component"],
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
  describe("turn limits", () => {
    const toolTurn = (id: string, args = "{}"): LlmTurn => ({
      content: null,
      toolCalls: [{ id, name: "list_components", arguments: args }],
    });

    /** Every assistant tool call is followed by exactly one matching tool message. */
    function assertHistoryValid(history: HistoryMessage[]) {
      const callIds: string[] = [];
      const answered: string[] = [];
      for (const m of history) {
        if (m.role === "assistant") callIds.push(...(m.tool_calls ?? []).map((c) => c.id));
        if (m.role === "tool") answered.push(m.tool_call_id);
      }
      assert.deepEqual(answered, callIds);
      history.forEach((m, i) => {
        if (m.role !== "assistant" || !m.tool_calls) return;
        const next = history.slice(i + 1, i + 1 + m.tool_calls.length);
        assert.deepEqual(
          next.map((n) => n.role === "tool" && n.tool_call_id),
          m.tool_calls.map((c) => c.id),
        );
      });
    }

    it("sends the last allowed completion with tools off, and a text reply ends cleanly", async () => {
      const conversationId = "limit-last-step";
      const tools = stubTools();
      const { log, infos } = infoLog();
      const { run, events } = makeRun(tools, { log });
      const turns = Array.from({ length: MAX_STEPS - 1 }, (_, i) =>
        toolTurn(`c${i}`, JSON.stringify({ n: i })),
      );
      const llm = scriptedLlm([...turns, { content: "Here is what I have.", toolCalls: [] }]);

      await runAgent("go", conversationId, run, llm);
      const history = getHistory(conversationId);
      resetConversation(conversationId);

      assert.equal(llm.calls.length, MAX_STEPS);
      assert.deepEqual(
        llm.calls.map((c) => c.allowTools),
        [...Array(MAX_STEPS - 1).fill(true), false],
      );
      assert.equal(events.some((e) => e.type === "error"), false);
      assert.deepEqual(events.at(-1), { type: "text", text: "Here is what I have." });
      assert.equal(tools.ran.length, MAX_STEPS - 1);
      assertHistoryValid(history);
      assert.equal(infos.length, 1);
      assert.deepEqual(infos[0], {
        conversationId,
        steps: MAX_STEPS,
        toolCalls: MAX_STEPS - 1,
        promptTokens: 0,
        completionTokens: 0,
        endedBy: "reply",
      });
    });

    it("errors, without running tools, when the model ignores tools being off", async () => {
      const conversationId = "limit-ignored-off";
      const tools = stubTools();
      const { log, infos } = infoLog();
      const { run, events } = makeRun(tools, { log });
      // Distinct arguments each time, so only the step cap is involved.
      let n = 0;
      const llm: AgentLlm = {
        async complete({ allowTools }) {
          n += 1;
          return toolTurn(`c${n}`, JSON.stringify({ n, allowTools }));
        },
      };

      await runAgent("go", conversationId, run, llm);
      const history = getHistory(conversationId);
      resetConversation(conversationId);

      assert.equal(n, MAX_STEPS);
      assert.equal(tools.ran.length, MAX_STEPS - 1);
      const error = events.find((e) => e.type === "error");
      assert.ok(error && /too many steps/i.test(error.message));
      assertHistoryValid(history);
      assert.equal(infos[0].endedBy, "max_steps");
    });

    it("does not run the 21st tool call, then turns tools off", async () => {
      const conversationId = "limit-tool-budget";
      const tools = stubTools();
      const { log, infos } = infoLog();
      const { run, events } = makeRun(tools, { log });
      const calls = Array.from({ length: MAX_TOOL_CALLS_PER_TURN + 1 }, (_, i) => ({
        id: `c${i}`,
        name: "list_components",
        arguments: JSON.stringify({ n: i }),
      }));
      const llm = scriptedLlm([
        { content: null, toolCalls: calls.slice(0, 10) },
        { content: null, toolCalls: calls.slice(10) },
        { content: "Done with what I have.", toolCalls: [] },
      ]);

      await runAgent("go", conversationId, run, llm);
      const history = getHistory(conversationId);
      resetConversation(conversationId);

      assert.equal(tools.ran.length, MAX_TOOL_CALLS_PER_TURN);
      assert.deepEqual(
        llm.calls.map((c) => c.allowTools),
        [true, true, false],
      );
      const last = calls[MAX_TOOL_CALLS_PER_TURN];
      const lastCall = { id: last.id, name: last.name, args: { n: MAX_TOOL_CALLS_PER_TURN } };
      const at = events.findIndex((e) => e.type === "tool_call" && e.call.id === last.id);
      assert.deepEqual(events[at + 1], {
        type: "tool_result",
        call: lastCall,
        result: { ok: false, summary: "Tool budget used up" },
      });
      const row = history.find((m) => m.role === "tool" && m.tool_call_id === last.id);
      assert.ok(row && row.role === "tool");
      assert.equal(
        row.content,
        "Tool budget for this turn is used up; answer with what you have.",
      );
      assert.equal(events.some((e) => e.type === "error"), false);
      assertHistoryValid(history);
      assert.equal(infos[0].toolCalls, MAX_TOOL_CALLS_PER_TURN + 1);
      assert.equal(infos[0].endedBy, "reply");
    });

    it("does not rerun an identical call, and counts it toward the budget", async () => {
      const conversationId = "limit-repeat";
      const tools = stubTools();
      const { run, events } = makeRun(tools);
      const llm = scriptedLlm([
        {
          content: null,
          toolCalls: [
            { id: "a", name: "list_components", arguments: '{"x":1,"y":{"p":1,"q":2}}' },
            { id: "b", name: "list_components", arguments: '{"y":{"q":2,"p":1},"x":1}' },
          ],
        },
        { content: "ok", toolCalls: [] },
      ]);

      await runAgent("go", conversationId, run, llm);
      const history = getHistory(conversationId);
      resetConversation(conversationId);

      assert.equal(tools.ran.length, 1);
      const results = events.filter((e) => e.type === "tool_result");
      assert.equal(results.length, 2);
      assert.deepEqual(results[1].result, {
        ok: false,
        summary: "Already called with these arguments",
      });
      const row = history.find((m) => m.role === "tool" && m.tool_call_id === "b");
      assert.ok(row && row.role === "tool");
      assert.equal(
        row.content,
        "You already called `list_components` with these arguments in this turn; use that result.",
      );
      assertHistoryValid(history);
    });

    it("counts repeats toward the tool-call budget", async () => {
      const conversationId = "limit-repeat-budget";
      const tools = stubTools();
      const { run } = makeRun(tools);
      const same = Array.from({ length: MAX_TOOL_CALLS_PER_TURN }, (_, i) => ({
        id: `c${i}`,
        name: "list_components",
        arguments: "{}",
      }));
      const llm = scriptedLlm([
        { content: null, toolCalls: same },
        { content: "ok", toolCalls: [] },
      ]);

      await runAgent("go", conversationId, run, llm);
      resetConversation(conversationId);

      assert.equal(tools.ran.length, 1);
      assert.equal(llm.calls[1].allowTools, false);
    });

    it("turns tools off once summed usage reaches the token budget", async () => {
      const conversationId = "limit-tokens";
      const tools = stubTools();
      const { log, infos } = infoLog();
      const { run } = makeRun(tools, { log });
      const half = MAX_TURN_TOKENS / 2;
      const llm = scriptedLlm([
        { ...toolTurn("c1", '{"n":1}'), usage: { promptTokens: half - 100, completionTokens: 100 } },
        { ...toolTurn("c2", '{"n":2}'), usage: { promptTokens: half - 100, completionTokens: 99 } },
        { ...toolTurn("c3", '{"n":3}'), usage: { promptTokens: 1, completionTokens: 0 } },
        { content: "ok", toolCalls: [] },
      ]);

      await runAgent("go", conversationId, run, llm);
      resetConversation(conversationId);

      // After two completions the sum is one short of the budget; the third
      // brings it to the budget, so the fourth has tools off.
      assert.deepEqual(
        llm.calls.map((c) => c.allowTools),
        [true, true, true, false],
      );
      assert.equal(infos[0].promptTokens, MAX_TURN_TOKENS - 199);
      assert.equal(infos[0].completionTokens, 199);
    });

    it("notices a reply that was cut off", async () => {
      const conversationId = "limit-truncated";
      const { run, events } = makeRun(stubTools());
      const llm = scriptedLlm([{ content: "A long rep", toolCalls: [], truncated: true }]);

      await runAgent("go", conversationId, run, llm);
      resetConversation(conversationId);

      assert.deepEqual(events, [
        { type: "text", text: "A long rep" },
        { type: "notice", message: TRUNCATED_NOTICE },
      ]);
    });

    it("logs the turn as stopped when the user stops it", async () => {
      const conversationId = "limit-stopped";
      const controller = new AbortController();
      controller.abort();
      const { log, infos } = infoLog();
      const { run } = makeRun(stubTools(), { signal: controller.signal, log });

      await runAgent("hi", conversationId, run, scriptedLlm([]));
      resetConversation(conversationId);

      assert.equal(infos.length, 1);
      assert.equal(infos[0].endedBy, "stopped");
      assert.equal(infos[0].steps, 0);
    });
  });

  describe("turn traces", () => {
    it("stores a text-only turn with one completion and no tool calls", async () => {
      const conversationId = "trace-text-only";
      const { run } = makeRun(stubTools());
      const llm = scriptedLlm([{ content: "Hello there.", toolCalls: [] }]);

      await runAgent("hi", conversationId, run, llm);
      const traces = await run.traces.listByConversation(conversationId);
      resetConversation(conversationId);

      assert.equal(traces.length, 1);
      assert.equal(traces[0].userText, "hi");
      assert.equal(traces[0].endedBy, "reply");
      assert.deepEqual(traces[0].completions, [
        {
          allowTools: true,
          content: "Hello there.",
          truncated: false,
          toolCalls: [],
        },
      ]);
      assert.equal(traces[0].error, undefined);
    });

    it("stores a trace when aborted before the first completion", async () => {
      const conversationId = "trace-aborted-early";
      const controller = new AbortController();
      controller.abort();
      const { run } = makeRun(stubTools(), { signal: controller.signal });

      await runAgent("hi", conversationId, run, scriptedLlm([]));
      const traces = await run.traces.listByConversation(conversationId);
      resetConversation(conversationId);

      assert.equal(traces.length, 1);
      assert.deepEqual(traces[0].completions, []);
      assert.equal(traces[0].endedBy, "stopped");
      assert.equal(traces[0].steps, 0);
    });

    it("sets error when the model ignores tools being off", async () => {
      const conversationId = "trace-tools-off-error";
      const tools = stubTools();
      const { run } = makeRun(tools);
      let n = 0;
      const llm: AgentLlm = {
        async complete({ allowTools }) {
          n += 1;
          return {
            content: null,
            toolCalls: [
              { id: `c${n}`, name: "list_components", arguments: JSON.stringify({ n, allowTools }) },
            ],
          };
        },
      };

      await runAgent("go", conversationId, run, llm);
      const traces = await run.traces.listByConversation(conversationId);
      resetConversation(conversationId);

      assert.ok(traces[0].error?.match(/too many steps/i));
      assert.equal(traces[0].endedBy, "max_steps");
    });

    it("records ui on a successful render_ui tool call", async () => {
      const conversationId = "trace-render-ui";
      const tools = createToolRegistry(
        createAgentTools({ components: new InMemoryComponentRepository(catalog) }),
      );
      const { run, events } = makeRun(tools, { conversationId });
      const tree = { component: "Card", props: { title: "Hi" } };
      const llm = scriptedLlm([
        {
          content: null,
          toolCalls: [{ id: "call_ui", name: "render_ui", arguments: JSON.stringify({ tree }) }],
        },
        { content: "Done.", toolCalls: [] },
      ]);

      await runAgent("draw", conversationId, run, llm);
      const traces = await run.traces.listByConversation(conversationId);
      const ui = events.find((e) => e.type === "ui");
      resetConversation(conversationId);

      assert.ok(ui?.type === "ui");
      const tc = traces[0].completions[0].toolCalls[0];
      assert.equal(tc.skipped, undefined);
      assert.deepEqual(tc.ui, { id: ui.id, tree: ui.tree });
    });

    it("omits ui when render_ui fails validation", async () => {
      const conversationId = "trace-render-fail";
      const tools = createToolRegistry(
        createAgentTools({ components: new InMemoryComponentRepository(catalog) }),
      );
      const { run, events } = makeRun(tools, { conversationId });
      const llm = scriptedLlm([
        {
          content: null,
          toolCalls: [
            { id: "call_bad", name: "render_ui", arguments: JSON.stringify({ tree: { component: "Nope" } }) },
          ],
        },
        { content: "Sorry.", toolCalls: [] },
      ]);

      await runAgent("draw", conversationId, run, llm);
      const traces = await run.traces.listByConversation(conversationId);
      resetConversation(conversationId);

      assert.equal(events.some((e) => e.type === "ui"), false);
      const tc = traces[0].completions[0].toolCalls[0];
      assert.equal(tc.ui, undefined);
      assert.equal(tc.skipped, undefined);
    });

    it("records duplicate and budget skip reasons", async () => {
      const conversationId = "trace-skips";
      const tools = stubTools();
      const { run } = makeRun(tools);
      const calls = Array.from({ length: MAX_TOOL_CALLS_PER_TURN + 1 }, (_, i) => ({
        id: `c${i}`,
        name: "list_components",
        arguments: JSON.stringify({ n: i }),
      }));
      const llm = scriptedLlm([
        {
          content: null,
          toolCalls: [
            { id: "dup_a", name: "list_components", arguments: '{"x":1}' },
            { id: "dup_b", name: "list_components", arguments: '{"x":1}' },
          ],
        },
        { content: null, toolCalls: calls.slice(0, 10) },
        { content: null, toolCalls: calls.slice(10) },
        { content: "ok", toolCalls: [] },
      ]);

      await runAgent("go", conversationId, run, llm);
      const trace = (await run.traces.listByConversation(conversationId))[0];
      resetConversation(conversationId);

      const dup = trace.completions[0].toolCalls.find((t) => t.call.id === "dup_b");
      assert.equal(dup?.skipped, "duplicate");

      const over = trace.completions[2].toolCalls.find((t) => t.call.id === calls[MAX_TOOL_CALLS_PER_TURN].id);
      assert.equal(over?.skipped, "budget");
      assert.equal(trace.toolCalls, MAX_TOOL_CALLS_PER_TURN + 3);
    });

    it("records stopped when the tool does not run because the turn was aborted", async () => {
      const conversationId = "trace-stopped-tool";
      const controller = new AbortController();
      const tools = stubTools();
      const { run } = makeRun(tools, { signal: controller.signal });
      const llm: AgentLlm = {
        async complete() {
          controller.abort();
          return {
            content: null,
            toolCalls: [{ id: "call_1", name: "list_components", arguments: "{}" }],
          };
        },
      };

      await runAgent("list", conversationId, run, llm);
      const tc = (await run.traces.listByConversation(conversationId))[0].completions[0].toolCalls[0];
      resetConversation(conversationId);

      assert.equal(tc.skipped, "stopped");
    });

    it("does not put the forgotten-conversation notice on the trace", async () => {
      const conversationId = "trace-forgotten";
      resetConversation(conversationId);
      const { run } = makeRun(stubTools(), { resume: true });
      const llm = scriptedLlm([{ content: "Hi again.", toolCalls: [] }]);

      await runAgent("as I said", conversationId, run, llm);
      const trace = (await run.traces.listByConversation(conversationId))[0];
      resetConversation(conversationId);

      assert.equal(trace.userText, "as I said");
      assert.equal((trace as { notice?: string }).notice, undefined);
    });

    it("matches the usage log totals on the trace", async () => {
      const conversationId = "trace-usage-match";
      const tools = stubTools();
      const { log, infos } = infoLog();
      const { run } = makeRun(tools, { log });
      const llm = scriptedLlm([
        {
          content: null,
          toolCalls: [{ id: "c1", name: "list_components", arguments: "{}" }],
          usage: { promptTokens: 10, completionTokens: 5 },
        },
        { content: "done", toolCalls: [], usage: { promptTokens: 20, completionTokens: 8 } },
      ]);

      await runAgent("go", conversationId, run, llm);
      const trace = (await run.traces.listByConversation(conversationId))[0];
      resetConversation(conversationId);

      assert.deepEqual(infos[0], {
        conversationId,
        steps: 2,
        toolCalls: 1,
        promptTokens: 30,
        completionTokens: 13,
        endedBy: "reply",
      });
      assert.equal(trace.steps, infos[0].steps);
      assert.equal(trace.toolCalls, infos[0].toolCalls);
      assert.equal(trace.promptTokens, infos[0].promptTokens);
      assert.equal(trace.completionTokens, infos[0].completionTokens);
      assert.equal(trace.endedBy, infos[0].endedBy);
    });

    it("keeps traces in the repository after resetConversation", async () => {
      const conversationId = "trace-survives-reset";
      const { run } = makeRun(stubTools());
      const llm = scriptedLlm([{ content: "Hello.", toolCalls: [] }]);

      await runAgent("hi", conversationId, run, llm);
      assert.equal((await run.traces.listByConversation(conversationId)).length, 1);
      resetConversation(conversationId);
      assert.equal((await run.traces.listByConversation(conversationId)).length, 1);
    });

    it("still streams the same events when trace save fails", async () => {
      const conversationId = "trace-save-fail";
      const warns: Array<Record<string, unknown>> = [];
      const log: ToolLogger = {
        ...noopLogger,
        warn: (obj) => warns.push(obj as Record<string, unknown>),
      };
      const traces: TraceRepository = {
        async save() {
          throw new Error("disk full");
        },
        async listByConversation() {
          return [];
        },
      };
      const { run, events } = makeRun(stubTools(), { conversationId, log, traces });
      const llm = scriptedLlm([{ content: "Hello there.", toolCalls: [] }]);

      await runAgent("hi", conversationId, run, llm);

      assert.deepEqual(events, [{ type: "text", text: "Hello there." }]);
      assert.equal(warns.length, 1);
      assert.equal(warns[0].conversationId, conversationId);
      assert.equal("userText" in warns[0], false);
    });
  });
});
