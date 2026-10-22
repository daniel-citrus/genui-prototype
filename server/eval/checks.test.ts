import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentTrace, AgentTraceToolCall } from "../agent/trace";
import { checkTrace } from "./checks";

const DISTINCTIVE_USER_TEXT = "UNIQUE_EVAL_USER_TEXT_DO_NOT_LEAK_42";

function emptyTrace(overrides: Partial<AgentTrace> = {}): AgentTrace {
  return {
    conversationId: "eval-test",
    userText: DISTINCTIVE_USER_TEXT,
    endedBy: "reply",
    steps: 1,
    toolCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    completions: [{ allowTools: true, content: "hello", truncated: false, toolCalls: [] }],
    ...overrides,
  };
}

function toolCall(partial: AgentTraceToolCall): AgentTraceToolCall {
  return partial;
}

function traceWithToolCalls(...toolCalls: AgentTraceToolCall[]): AgentTrace {
  return emptyTrace({
    completions: [{ allowTools: true, content: null, truncated: false, toolCalls }],
  });
}

function renderUiTree(tree: unknown, ok = true): AgentTraceToolCall {
  return toolCall({
    call: { id: "1", name: "render_ui", args: { secret: "args must not appear in reasons" } },
    result: { ok, summary: "rendered" },
    ui: { id: "ui-1", tree: tree as never },
  });
}

describe("checkTrace", () => {
  it("endedBy passes and fails", () => {
    assert.deepEqual(checkTrace(emptyTrace({ endedBy: "reply" }), [{ endedBy: "reply" }]), []);
    const failures = checkTrace(emptyTrace({ endedBy: "max_steps" }), [{ endedBy: "reply" }]);
    assert.equal(failures.length, 1);
    assert.match(failures[0]!.reason, /endedBy "reply"/);
  });

  it("noError passes and fails", () => {
    assert.deepEqual(checkTrace(emptyTrace(), [{ noError: true }]), []);
    const failures = checkTrace(emptyTrace({ error: "boom" }), [{ noError: true }]);
    assert.equal(failures.length, 1);
    assert.match(failures[0]!.reason, /noError/);
  });

  it("toolCalled counts skipped calls", () => {
    const trace = traceWithToolCalls(
      toolCall({
        call: { id: "1", name: "list_components", args: {} },
        result: { ok: true, summary: "ok" },
        skipped: "budget",
      }),
    );
    assert.deepEqual(checkTrace(trace, [{ toolCalled: "list_components" }]), []);
    assert.equal(checkTrace(trace, [{ toolCalled: "render_ui" }]).length, 1);
  });

  it("toolNotCalled passes when absent and fails on any call including skipped", () => {
    assert.deepEqual(checkTrace(emptyTrace(), [{ toolNotCalled: "list_actions" }]), []);

    const skipped = traceWithToolCalls(
      toolCall({
        call: { id: "1", name: "list_actions", args: {} },
        result: { ok: true, summary: "ok" },
        skipped: "budget",
      }),
    );
    const failures = checkTrace(skipped, [{ toolNotCalled: "list_actions" }]);
    assert.equal(failures.length, 1);
    assert.equal(failures[0]!.reason, 'toolNotCalled "list_actions": tool was called');
  });

  it("toolSucceeded requires ok and not skipped", () => {
    const ok = traceWithToolCalls(
      toolCall({
        call: { id: "1", name: "render_ui", args: {} },
        result: { ok: true, summary: "ok" },
      }),
    );
    assert.deepEqual(checkTrace(ok, [{ toolSucceeded: "render_ui" }]), []);

    const skipped = traceWithToolCalls(
      toolCall({
        call: { id: "1", name: "render_ui", args: {} },
        result: { ok: true, summary: "ok" },
        skipped: "budget",
      }),
    );
    assert.equal(checkTrace(skipped, [{ toolSucceeded: "render_ui" }]).length, 1);

    const failed = traceWithToolCalls(
      toolCall({
        call: { id: "1", name: "render_ui", args: {} },
        result: { ok: false, summary: "no" },
      }),
    );
    assert.equal(checkTrace(failed, [{ toolSucceeded: "render_ui" }]).length, 1);
  });

  it("uses the last successful render_ui tree", () => {
    const first = renderUiTree({ component: "Heading", props: { text: "A" } });
    const second = renderUiTree({
      component: "Stack",
      props: {},
      children: [{ component: "Button", props: { action: "demo_echo", label: "Go" } }],
    });
    const trace = traceWithToolCalls(first, second);

    assert.deepEqual(checkTrace(trace, [{ uiComponent: "Button" }]), []);
    assert.equal(checkTrace(trace, [{ uiComponent: "Heading" }]).length, 1);
    assert.deepEqual(checkTrace(trace, [{ uiButtonAction: "demo_echo" }]), []);
  });

  it("uiComponent walks children", () => {
    const trace = traceWithToolCalls(
      renderUiTree({
        component: "Stack",
        props: {},
        children: [{ component: "TextInput", props: { name: "text", label: "T" } }],
      }),
    );
    assert.deepEqual(checkTrace(trace, [{ uiComponent: "TextInput" }]), []);
    assert.equal(checkTrace(trace, [{ uiComponent: "Heading" }]).length, 1);
  });

  it("uiNamedInput uses collectBindings", () => {
    const trace = traceWithToolCalls(
      renderUiTree({
        component: "TextInput",
        props: { name: "text", label: "T" },
      }),
    );
    assert.deepEqual(checkTrace(trace, [{ uiNamedInput: "text" }]), []);
    assert.equal(checkTrace(trace, [{ uiNamedInput: "missing" }]).length, 1);
  });

  it("UI checks fail when there is no successful render_ui", () => {
    const trace = emptyTrace();
    for (const check of [
      { uiComponent: "Heading" },
      { uiButtonAction: "demo_echo" },
      { uiNamedInput: "text" },
    ] as const) {
      const failures = checkTrace(trace, [check]);
      assert.equal(failures.length, 1);
      assert.match(failures[0]!.reason, /no successful render_ui tree/);
    }
  });

  it("fail reasons omit userText, completion text, tool args, and tree JSON", () => {
    const trace = traceWithToolCalls(
      toolCall({
        call: { id: "1", name: "render_ui", args: { secretArg: "tool-args-must-not-leak" } },
        result: { ok: false, summary: "completion-summary-must-not-leak" },
      }),
    );
    trace.completions[0]!.content = "completion-text-must-not-leak";

    const failures = checkTrace(trace, [
      { endedBy: "stopped" },
      { toolCalled: "list_actions" },
      { uiComponent: "Heading" },
    ]);
    assert.ok(failures.length >= 3);
    const blob = failures.map((f) => f.reason).join("\n");
    assert.doesNotMatch(blob, new RegExp(DISTINCTIVE_USER_TEXT));
    assert.doesNotMatch(blob, /completion-text-must-not-leak/);
    assert.doesNotMatch(blob, /tool-args-must-not-leak/);
    assert.doesNotMatch(blob, /secretArg/);
    assert.doesNotMatch(blob, /"component"/);
  });
});
