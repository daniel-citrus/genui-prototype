import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UiNode } from "shared/ui";
import type { Generation } from "../generate/generate";
import { checkGeneration } from "./checks";
import type { EvalCheck } from "./types";

type Designed = Extract<Generation, { ok: true }>;

const tree: UiNode = {
  component: "Stack",
  props: {},
  children: [
    { component: "Heading", props: { text: "Hello there" } },
    { component: "TextInput", props: { name: "email", label: "Email" } },
    { component: "Button", props: { label: "Go", action: "demo_echo" } },
    { component: "Markup", props: { root: { tag: "ul", children: [{ tag: "li", text: "Mocha" }] } } },
  ],
};

function designed(over: Partial<Designed> = {}): Designed {
  return {
    ok: true,
    tree,
    notes: "Made a form.",
    attempts: [{ content: "{}", truncated: false, tree: { component: "Saved", children: [] }, problems: [] }],
    ...over,
  };
}

function reasons(check: EvalCheck, generation = designed()): string[] {
  return checkGeneration(generation, [check]).map((f) => f.reason);
}

describe("checkGeneration", () => {
  const cases: [string, EvalCheck, EvalCheck][] = [
    ["maxAttempts", { maxAttempts: 1 }, { maxAttempts: 0 }],
    ["uiComponent", { uiComponent: "Heading" }, { uiComponent: "Card" }],
    ["noUiComponent", { noUiComponent: "Card" }, { noUiComponent: "Heading" }],
    ["uiButtonAction", { uiButtonAction: "demo_echo" }, { uiButtonAction: "other" }],
    ["uiNamedInput", { uiNamedInput: "email" }, { uiNamedInput: "phone" }],
    ["uiText", { uiText: "Hello" }, { uiText: "Goodbye" }],
    ["uiMarkupTag", { uiMarkupTag: "li" }, { uiMarkupTag: "svg" }],
    ["agentComponent", { agentComponent: "Saved" }, { agentComponent: "Heading" }],
    ["notesMaxWords", { notesMaxWords: 3 }, { notesMaxWords: 2 }],
    ["notesExcludes", { notesExcludes: "JSON" }, { notesExcludes: "form" }],
  ];

  for (const [name, passing, failing] of cases) {
    it(`${name} passes and fails`, () => {
      assert.deepEqual(reasons(passing), []);
      const failures = checkGeneration(designed(), [failing]);
      assert.equal(failures.length, 1);
      assert.deepEqual(failures[0]!.check, failing);
      assert.ok(failures[0]!.reason.startsWith(`${name}`));
    });
  }

  it("noButtonAction passes for a button without an action and fails with one or with no button", () => {
    const bare: UiNode = { component: "Button", props: { label: "Go" } };
    assert.deepEqual(reasons({ noButtonAction: true }, designed({ tree: bare })), []);
    assert.deepEqual(reasons({ noButtonAction: true }), ["noButtonAction: a button has an action"]);
    const none: UiNode = { component: "Heading", props: { text: "Hi" } };
    assert.deepEqual(reasons({ noButtonAction: true }, designed({ tree: none })), ["noButtonAction: no Button in the tree"]);
  });

  it("agentComponent reads the tree of the final attempt only", () => {
    const attempts = [
      { content: "{}", truncated: false, tree: { component: "Old" }, problems: ["bad"] },
      { content: "{}", truncated: false, tree: { component: "Heading" }, problems: [] },
    ];
    assert.deepEqual(reasons({ agentComponent: "Heading" }, designed({ attempts })), []);
    assert.equal(reasons({ agentComponent: "Old" }, designed({ attempts })).length, 1);
    const noTree = [{ content: null, truncated: false, problems: [] }];
    assert.deepEqual(reasons({ agentComponent: "Heading" }, designed({ attempts: noTree })), [
      'agentComponent "Heading": the final attempt has no tree',
    ]);
  });

  it("reports every failing check", () => {
    const failures = checkGeneration(designed(), [{ uiText: "Nope" }, { uiComponent: "Heading" }, { uiComponent: "Card" }]);
    assert.equal(failures.length, 2);
  });
});
