import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoEchoAction } from "./demo";
import { createActionRegistry } from "./registry";
import type { ActionContext } from "./types";

const ctx: ActionContext = {
  designId: "design-1",
  signal: new AbortController().signal,
  log: { info() {}, debug() {}, error() {}, warn() {} },
};

describe("demo_echo", () => {
  it("has one optional, described string property capped at 1000 characters", () => {
    const { properties, required } = demoEchoAction.input_schema as {
      properties: Record<string, Record<string, unknown>>;
      required?: string[];
    };
    assert.deepEqual(Object.keys(properties), ["text"]);
    const { description, ...rest } = properties.text ?? {};
    assert.deepEqual(rest, { type: "string", maxLength: 1000 });
    assert.equal(typeof description, "string");
    assert.equal(required, undefined);
  });

  it("echoes the text it was sent", async () => {
    const result = await demoEchoAction.run({ text: "hello" }, ctx);
    assert.deepEqual(result, { ok: true, message: "Demo action received: hello" });
  });

  it("says it ran when sent no text", async () => {
    const result = await demoEchoAction.run({}, ctx);
    assert.deepEqual(result, { ok: true, message: "Demo action ran." });
  });

  it("refuses text over 1000 characters through the registry", async () => {
    const registry = createActionRegistry([demoEchoAction]);
    const result = await registry.run("demo_echo", { text: "x".repeat(1001) }, ctx);
    assert.equal(result.ok, false);
  });
});
