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

  it("agentComponent reads the render_ui arguments, not the sandbox tree", () => {
    const trace = traceWithToolCalls(
      toolCall({
        call: { id: "1", name: "render_ui", args: { tree: { component: "PromoBanner", props: {} } } },
        result: { ok: true, summary: "rendered" },
        ui: { id: "ui-1", tree: { component: "Card", props: {} } as never },
      }),
    );
    assert.deepEqual(checkTrace(trace, [{ agentComponent: "PromoBanner" }]), []);
    assert.equal(checkTrace(trace, [{ uiComponent: "PromoBanner" }]).length, 1);
    const missing = checkTrace(trace, [{ agentComponent: "Heading" }]);
    assert.equal(
      missing[0]!.reason,
      'agentComponent "Heading": component not found in the render_ui arguments',
    );
  });

  it("agentComponent walks children and ignores props", () => {
    const trace = traceWithToolCalls(
      toolCall({
        call: {
          id: "1",
          name: "render_ui",
          args: {
            tree: {
              component: "Stack",
              props: { inner: { component: "Hidden" } },
              children: [{ component: "Deep", props: {} }],
            },
          },
        },
        result: { ok: true, summary: "rendered" },
        ui: { id: "ui-1", tree: { component: "Card", props: {} } as never },
      }),
    );
    assert.deepEqual(checkTrace(trace, [{ agentComponent: "Deep" }]), []);
    assert.equal(checkTrace(trace, [{ agentComponent: "Hidden" }]).length, 1);
  });

  it("agentComponent fails when the arguments tree is missing or there is no render", () => {
    const missing = checkTrace(traceWithToolCalls(renderUiTree({ component: "Card", props: {} })), [
      { agentComponent: "Card" },
    ]);
    assert.equal(missing[0]!.reason, 'agentComponent "Card": arguments tree is missing');
    const none = checkTrace(emptyTrace(), [{ agentComponent: "Card" }]);
    assert.equal(
      none[0]!.reason,
      'agentComponent "Card": no successful render_ui tree on trace (result.ok, ui present, not skipped)',
    );
  });

  it("agentComponent ignores a failed later render_ui", () => {
    const good = toolCall({
      call: { id: "1", name: "render_ui", args: { tree: { component: "PromoBanner", props: {} } } },
      result: { ok: true, summary: "rendered" },
      ui: { id: "ui-1", tree: { component: "Card", props: {} } as never },
    });
    const bad = toolCall({
      call: { id: "2", name: "render_ui", args: { tree: { component: "Other", props: {} } } },
      result: { ok: false, summary: "bad" },
    });
    assert.deepEqual(checkTrace(traceWithToolCalls(good, bad), [{ agentComponent: "PromoBanner" }]), []);
  });

  it("noButtonAction passes only for a Button with no action", () => {
    const noAction = traceWithToolCalls(
      renderUiTree({ component: "Button", props: { label: "Go" } }),
    );
    assert.deepEqual(checkTrace(noAction, [{ noButtonAction: true }]), []);

    const withAction = traceWithToolCalls(
      renderUiTree({ component: "Button", props: { label: "Go", action: "demo_echo" } }),
    );
    assert.equal(
      checkTrace(withAction, [{ noButtonAction: true }])[0]!.reason,
      "noButtonAction: a button has an action",
    );

    const noButton = traceWithToolCalls(renderUiTree({ component: "Text", props: {} }));
    assert.equal(
      checkTrace(noButton, [{ noButtonAction: true }])[0]!.reason,
      "noButtonAction: no Button in the last render_ui tree",
    );

    const markupOnly = traceWithToolCalls(
      renderUiTree({
        component: "Markup",
        props: {
          root: { tag: "button", attrs: { action: "demo_echo" }, children: [] },
        },
      }),
    );
    assert.equal(
      checkTrace(markupOnly, [{ noButtonAction: true }])[0]!.reason,
      "noButtonAction: no Button in the last render_ui tree",
    );

    assert.equal(
      checkTrace(emptyTrace(), [{ noButtonAction: true }])[0]!.reason,
      "noButtonAction: no successful render_ui tree on trace (result.ok, ui present, not skipped)",
    );
  });

  it("agentComponent and noButtonAction reasons omit planted secrets on a successful render", () => {
    const trace = traceWithToolCalls(
      toolCall({
        call: {
          id: "1",
          name: "render_ui",
          args: { tree: { component: "Text", props: { text: "tool-args-must-not-leak" } } },
        },
        result: { ok: true, summary: "rendered" },
        ui: {
          id: "ui-1",
          tree: {
            component: "Button",
            props: { label: "tree-json-must-not-leak", action: "tree-action-must-not-leak" },
          } as never,
        },
      }),
    );
    trace.completions[0]!.content = "completion-text-must-not-leak";

    const failures = checkTrace(trace, [
      { agentComponent: "Missing" },
      { noButtonAction: true },
    ]);
    assert.equal(failures.length, 2);
    const blob = failures.map((f) => f.reason).join("\n");
    assert.doesNotMatch(blob, new RegExp(DISTINCTIVE_USER_TEXT));
    assert.doesNotMatch(blob, /completion-text-must-not-leak/);
    assert.doesNotMatch(blob, /tool-args-must-not-leak/);
    assert.doesNotMatch(blob, /tree-json-must-not-leak/);
    assert.doesNotMatch(blob, /tree-action-must-not-leak/);
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
