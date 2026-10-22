import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { EvalCase } from "./types";
import { loadCases } from "./loadCases";
import { main } from "./cli";

const committedCasesDir = join(dirname(fileURLToPath(import.meta.url)), "cases");

describe("eval cli committed cases", () => {
  it("loads simple-heading and echo-form", () => {
    const cases = loadCases(committedCasesDir);
    const byId = new Map(cases.map((c) => [c.id, c]));

    assert.deepEqual(byId.get("simple-heading"), {
      id: "simple-heading",
      prompt: "Show a heading that says Hello",
      checks: [
        { endedBy: "reply" },
        { noError: true },
        { toolSucceeded: "render_ui" },
        { uiComponent: "Heading" },
      ],
    } satisfies EvalCase);

    assert.deepEqual(byId.get("echo-form"), {
      id: "echo-form",
      prompt:
        "Show a form with a text field and a button that runs the demo echo action with what I type",
      checks: [
        { endedBy: "reply" },
        { noError: true },
        { toolCalled: "list_actions" },
        { toolSucceeded: "render_ui" },
        { uiButtonAction: "demo_echo" },
        { uiNamedInput: "text" },
      ],
    } satisfies EvalCase);
  });
});

describe("eval cli main", () => {
  it("refuses when the agent is not available", async () => {
    const lines: string[] = [];
    let loadCalled = false;
    let runCalled = false;
    let llmCalled = false;

    const code = await main({
      agentAvailable: false,
      log: (line) => lines.push(line),
      error: (line) => lines.push(line),
      inject: {
        loadCases: () => {
          loadCalled = true;
          return [];
        },
        runEvalCase: async () => {
          runCalled = true;
          return { id: "x", ok: true, failures: [] };
        },
        createOpenAILlm: () => {
          llmCalled = true;
          return {
            async complete() {
              return { content: null, toolCalls: [] };
            },
          };
        },
      },
    });

    assert.notEqual(code, 0);
    assert.match(lines.join("\n"), /OPENAI_API_KEY/);
    assert.equal(loadCalled, false);
    assert.equal(runCalled, false);
    assert.equal(llmCalled, false);
  });
});
