import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { EvalCase } from "./types";
import { loadCases } from "./loadCases";
import { main } from "./cli";

const committedCasesDir = join(dirname(fileURLToPath(import.meta.url)), "cases");

const committedCases: EvalCase[] = [
  {
    id: "catalog-layout",
    prompt:
      "Show a Card titled Specials. Inside it put a Heading that says Today's drinks and a Text line under the heading. Group them with a Stack.",
    checks: [
      { endedBy: "reply" },
      { noError: true },
      { toolSucceeded: "render_ui" },
      { uiComponent: "Stack" },
      { uiComponent: "Card" },
      { uiComponent: "Heading" },
      { uiComponent: "Text" },
    ],
  },
  {
    id: "define-and-use-custom",
    prompt:
      "Define a reusable custom component named PromoBanner: a Card whose children are a Heading and a Text. Then show PromoBanner.",
    checks: [
      { endedBy: "reply" },
      { noError: true },
      { toolSucceeded: "define_component" },
      { toolSucceeded: "render_ui" },
      { uiComponent: "PromoBanner" },
    ],
  },
  {
    id: "delete-custom",
    prompt:
      "Define a custom component named TempNotice that is a Card with a Heading. Then delete TempNotice. You do not need to show it.",
    checks: [
      { endedBy: "reply" },
      { noError: true },
      { toolSucceeded: "define_component" },
      { toolSucceeded: "delete_component" },
    ],
  },
  {
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
  },
  {
    id: "menu-create-item",
    prompt: "Show a form to add a new drink to the café menu.",
    checks: [
      { endedBy: "reply" },
      { noError: true },
      { toolCalled: "list_actions" },
      { toolSucceeded: "render_ui" },
      { uiButtonAction: "menu_create_item" },
      { uiNamedInput: "name" },
      { uiNamedInput: "size" },
      { uiNamedInput: "price" },
    ],
  },
  {
    id: "menu-delete-category",
    prompt:
      "Show a form to delete a menu category. Say that the person will be asked to confirm before it runs.",
    checks: [
      { endedBy: "reply" },
      { noError: true },
      { toolCalled: "list_actions" },
      { toolSucceeded: "render_ui" },
      { uiButtonAction: "menu_delete_category" },
      { uiNamedInput: "category" },
    ],
  },
  {
    id: "mockup-no-action",
    prompt:
      "Show a mockup signup form with an email field, a password field, and a Create account button. The button must not run a server action.",
    checks: [
      { endedBy: "reply" },
      { noError: true },
      { toolNotCalled: "list_actions" },
      { toolSucceeded: "render_ui" },
      { uiComponent: "TextInput" },
      { uiComponent: "Button" },
    ],
  },
  {
    id: "off-topic-refusal",
    prompt: "What's the weather in Paris tomorrow?",
    checks: [
      { endedBy: "reply" },
      { noError: true },
      { toolNotCalled: "list_components" },
      { toolNotCalled: "list_actions" },
      { toolNotCalled: "render_ui" },
    ],
  },
  {
    id: "simple-heading",
    prompt: "Show a heading that says Hello",
    checks: [
      { endedBy: "reply" },
      { noError: true },
      { toolSucceeded: "render_ui" },
      { uiComponent: "Heading" },
    ],
  },
];

describe("eval cli committed cases", () => {
  it("loads all committed cases sorted by id", () => {
    const cases = loadCases(committedCasesDir);
    assert.deepEqual(cases, committedCases);
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
