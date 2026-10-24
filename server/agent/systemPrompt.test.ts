import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalog } from "../catalog/components";
import { InMemoryComponentRepository } from "../ports/fakes/InMemoryComponentRepository";
import { InMemoryCustomComponentRepository } from "../ports/fakes/InMemoryCustomComponentRepository";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { createAgentTools } from "./tools/index";

// As the server builds them, with custom components.
const toolNames = createAgentTools({
  components: new InMemoryComponentRepository(catalog),
  customComponents: new InMemoryCustomComponentRepository(),
}).map((t) => t.name);

describe("SYSTEM_PROMPT", () => {
  it("mentions every registered tool", () => {
    for (const name of toolNames) {
      assert.ok(SYSTEM_PROMPT.includes(name), `prompt does not mention tool ${name}`);
    }
  });

  it("names only registered tools in snake_case", () => {
    const words = SYSTEM_PROMPT.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [];
    for (const word of words) {
      assert.ok(toolNames.includes(word), `prompt mentions unknown tool ${word}`);
    }
  });

  it("tells the agent how to attach actions", () => {
    assert.ok(toolNames.includes("list_actions"));
    assert.match(SYSTEM_PROMPT, /call list_actions/);
    assert.match(SYSTEM_PROMPT, /won't do anything yet/);
    assert.doesNotMatch(SYSTEM_PROMPT, /nothing the person types/);
  });

  it("finds the action before choosing components", () => {
    const call = SYSTEM_PROMPT.indexOf("call list_actions");
    const choose = SYSTEM_PROMPT.indexOf("Choose the components you need");
    assert.ok(call >= 0 && choose >= 0);
    assert.ok(call < choose, "list_actions comes after choosing components");
    assert.ok(
      SYSTEM_PROMPT.includes(
        "call list_actions with the area and operation that fit what the button should do (any when unsure), and build the form around the returned inputs and choices",
      ),
    );
  });

  it("names the cases that don't need list_actions", () => {
    assert.ok(
      SYSTEM_PROMPT.includes(
        "Don't call list_actions when no button needs the server: a design without buttons, buttons that only move around the design (Cancel, Back, Close, Next), questions about the catalog, changes that leave a design's buttons alone, or a design the person calls a mockup.",
      ),
    );
  });

  it("explains others, choices, optional properties and confirmation", () => {
    for (const sentence of [
      "If the action you need is listed under others, call list_actions again with that action's area and operation.",
      "If no action fits, render the button without an action",
      "For an input that has choices, use a Select named after the input, with that source's values as its options.",
      "Besides every required property, give an input to each optional property the request mentions or implies; a form that edits something needs at least one field to change.",
      "If the action has a confirm question, the person is asked it before the action runs, so say so in the reply.",
    ]) {
      assert.ok(SYSTEM_PROMPT.includes(sentence), `prompt is missing: ${sentence}`);
    }
  });

  it("renders a button without an action rather than wiring a stand-in or asking", () => {
    const bullet =
      "   - Set the Button's action prop to the name of a returned action that fits: one whose description does what the button should do. If no action fits, render the button without an action and say that clicking it won't do anything yet. Do this also when the person names an action list_actions didn't return, or when only a demo or other unrelated action came back: never wire one as a stand-in. A missing action is not a reason to ask a question or to skip render_ui.";
    assert.ok(SYSTEM_PROMPT.includes(`\n${bullet}\n`), "prompt is missing the no-action bullet");
    const rulesBullet =
      "If the request is unclear in a way that changes the design, ask one short question in everyday words. Otherwise make a reasonable choice and mention it. A button that should do something, when list_actions returned no action whose description does that, is not unclear: render the button without an action and say that clicking it won't do anything yet, instead of asking.";
    assert.ok(SYSTEM_PROMPT.includes(`- ${rulesBullet}`), "prompt is missing the missing-action ask exception");
    assert.doesNotMatch(SYSTEM_PROMPT, /demo_echo/);
  });

  it("names the custom component tools", () => {
    for (const name of ["define_component", "delete_component"]) {
      assert.ok(toolNames.includes(name));
      assert.ok(SYSTEM_PROMPT.includes(name), `prompt does not mention tool ${name}`);
    }
  });

  it("prefers existing components and says when to define one", () => {
    for (const sentence of [
      "in this order of preference: catalog components, then existing custom components (from list_components), then a new custom component composed of those, defined with define_component.",
      "Use Markup, which draws a visual from a JSON tree, only when the person asks for a look the components can't produce, such as a chart, a rating or a specific style;",
      "For a one-off, put Markup directly in the design; define a component only for something reused or repeated.",
      "read a custom component with get_component like any other.",
      "Define one with define_component when the person asks to save or reuse part of a design, or when the request needs something no existing component draws.",
      "Never define one for a single use that existing components already cover.",
    ]) {
      assert.ok(SYSTEM_PROMPT.includes(sentence), `prompt is missing: ${sentence}`);
    }
    assert.doesNotMatch(SYSTEM_PROMPT, /nothing existing can draw/);
    assert.doesNotMatch(SYSTEM_PROMPT, /Markup may only be used inside a template/);
    assert.doesNotMatch(SYSTEM_PROMPT, /unique in the design/i);
    assert.doesNotMatch(SYSTEM_PROMPT, /using only catalog components/);
    assert.doesNotMatch(SYSTEM_PROMPT, /nothing in the catalog fits/);
  });

  it("allows only registered actions in templates, and no code", () => {
    for (const sentence of [
      "A template's buttons may only use actions list_actions returned. Never invent action names, and never try to create actions.",
      "Custom components cannot run JavaScript, link to other pages or cover the page.",
      "Never invent action names; use only names list_actions returned.",
    ]) {
      assert.ok(SYSTEM_PROMPT.includes(sentence), `prompt is missing: ${sentence}`);
    }
  });

  it("says when to report and delete custom components", () => {
    for (const sentence of [
      "Say in your reply when you saved or updated a custom component, by its name, and that it appears under Components.",
      "Use delete_component only when the person asks to delete a custom component.",
    ]) {
      assert.ok(SYSTEM_PROMPT.includes(sentence), `prompt is missing: ${sentence}`);
    }
  });

  it("fixes reported problems in the same turn instead of promising to retry", () => {
    const fix =
      "- Problems that render_ui or define_component reports are not failures: fix them and call the tool again in the same turn. Never reply that you will try again; call the tool instead.";
    const fail =
      "- If a tool fails for any other reason, say what you couldn't do instead of guessing. If you can no longer call tools in this turn, answer with what you have and say what is missing.";
    assert.ok(SYSTEM_PROMPT.endsWith(`\n${fix}\n${fail}`), "prompt does not end with the retry and failure rules");
    assert.ok(!SYSTEM_PROMPT.includes("If a tool fails, say what you couldn't do instead of guessing."));
  });

  it("keeps replies brief, plain and free of narration", () => {
    const rules = [
      "The people chatting with you are not technical: they don't know the component names, props or tools behind the app.",
      "reply in one short sentence, two at most, about what you made and any choice the person should know about. Don't repeat the design; the person can see it.",
      "- Keep replies short and in everyday words. Never mention tool names, component or prop names, JSON or code unless the person used them first; describe what the person sees instead (a name field, not a TextInput).",
      "- Write nothing before or between tool calls; reply once, after your last tool call.",
      "For anything unrelated to UI design, say in one sentence that you can only help with UI design here.",
    ];
    for (const sentence of rules) {
      assert.ok(SYSTEM_PROMPT.includes(sentence), `prompt is missing: ${sentence}`);
    }
    const fix = SYSTEM_PROMPT.indexOf("- Problems that render_ui or define_component reports");
    for (const sentence of rules.slice(2, 4)) {
      assert.ok(SYSTEM_PROMPT.indexOf(sentence) < fix, `rule comes after the retry rules: ${sentence}`);
    }
  });

  it("says how to read components and fill booleans", () => {
    for (const sentence of [
      "all in the same turn",
      "Omit the children property when a component's children is none. An empty array is dropped.",
      "Use a Checkbox for a boolean property.",
    ]) {
      assert.ok(SYSTEM_PROMPT.includes(sentence), `prompt is missing: ${sentence}`);
    }
  });

  it("teaches forms in Cards, locked item Selects, large lists and $each", () => {
    for (const sentence of [
      "Names must be unique within their Card, so put each form in its own Card",
      "a Button sends only the inputs in its nearest Card",
      "A form that edits one existing item has a Select, named after the input that identifies the item, with value set to that item and disabled.",
      "For many repeated forms, define a reusable item card component, or use one form with an item dropdown.",
      "Markup input, select and button belong only in a component's template, never directly in a design.",
      'use {"$each": "<prop>", "as": <node>} in a template\'s children',
    ]) {
      assert.ok(SYSTEM_PROMPT.includes(sentence), `prompt is missing: ${sentence}`);
    }
  });
});
