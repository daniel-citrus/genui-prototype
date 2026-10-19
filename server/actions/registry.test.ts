import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolLogger } from "../agent/tools";
import { createActions } from "./index";
import { createActionRegistry, MAX_ACTION_MESSAGE_CHARS } from "./registry";
import type { ActionContext, ActionDefinition } from "./types";

function recordingLogger(): ToolLogger & { errors: Record<string, unknown>[] } {
  const errors: Record<string, unknown>[] = [];
  return {
    errors,
    info() {},
    debug() {},
    error(obj) {
      errors.push(obj as Record<string, unknown>);
    },
  };
}

function makeCtx(signal = new AbortController().signal) {
  const log = recordingLogger();
  const ctx: ActionContext = { conversationId: "conv-1", signal, log };
  return { ctx, log };
}

const closedSchema = {
  type: "object",
  properties: {
    note: { type: "string", maxLength: 10, description: "A short note." },
    urgent: { type: "boolean", description: "Whether it is urgent." },
  },
  required: ["note"],
  additionalProperties: false,
};

function action(
  overrides: Partial<ActionDefinition> = {},
  run: ActionDefinition["run"] = async () => ({ ok: true, message: "done" }),
): ActionDefinition {
  return {
    name: "send_note",
    description: "Send a note.",
    input_schema: closedSchema,
    run,
    ...overrides,
  };
}

function withProperty(prop: Record<string, unknown>) {
  return action({
    input_schema: { type: "object", properties: { field: prop }, additionalProperties: false },
  });
}

describe("createActionRegistry construction", () => {
  it("lists specs in definition order without handlers", () => {
    const registry = createActionRegistry([
      action({ name: "b_action" }),
      action({ name: "a_action" }),
    ]);
    assert.deepEqual(registry.specs, [
      { name: "b_action", description: "Send a note.", input_schema: closedSchema },
      { name: "a_action", description: "Send a note.", input_schema: closedSchema },
    ]);
  });

  it("throws on a name that is not snake_case", () => {
    for (const name of ["SendNote", "send-note", "1send", "", "_send"]) {
      assert.throws(() => createActionRegistry([action({ name })]), /snake_case/, name);
    }
  });

  it("throws on a duplicate name", () => {
    assert.throws(() => createActionRegistry([action(), action()]), /Duplicate action name/);
  });

  it("throws on a schema that is not a closed object", () => {
    const open = { type: "object", properties: {} };
    const notObject = { type: "string", additionalProperties: false };
    for (const input_schema of [open, notObject]) {
      assert.throws(
        () => createActionRegistry([action({ input_schema })]),
        /additionalProperties: false/,
      );
    }
  });

  it("throws on a schema Ajv rejects", () => {
    const input_schema = {
      type: "object",
      properties: { x: { type: "nope" } },
      additionalProperties: false,
    };
    assert.throws(() => createActionRegistry([action({ input_schema })]), /invalid input_schema/);
  });

  it("throws on a property that is not a string or boolean", () => {
    for (const type of ["integer", "number", "array", "object", ["string", "null"]]) {
      assert.throws(
        () => createActionRegistry([withProperty({ type, description: "A field." })]),
        /must be a string or boolean/,
        JSON.stringify(type),
      );
    }
    assert.throws(
      () => createActionRegistry([withProperty({ description: "No type." })]),
      /must be a string or boolean/,
    );
  });

  it("throws on a property with no description", () => {
    assert.throws(
      () => createActionRegistry([withProperty({ type: "string" })]),
      /needs a description/,
    );
  });

  it("accepts the app's actions", () => {
    assert.doesNotThrow(() => createActionRegistry(createActions()));
  });
});

describe("createActionRegistry run", () => {
  it("passes valid values and the context to the handler", async () => {
    let received: { values: unknown; conversationId: string } | undefined;
    const registry = createActionRegistry([
      action({}, async (values, ctx) => {
        received = { values, conversationId: ctx.conversationId };
        return { ok: true, message: "sent" };
      }),
    ]);
    const { ctx } = makeCtx();

    const result = await registry.run("send_note", { note: "hi", urgent: true }, ctx);

    assert.deepEqual(result, { ok: true, message: "sent" });
    assert.deepEqual(received, { values: { note: "hi", urgent: true }, conversationId: "conv-1" });
  });

  it("refuses an unknown action without calling a handler", async () => {
    let called = false;
    const registry = createActionRegistry([
      action({}, async () => {
        called = true;
        return { ok: true, message: "" };
      }),
    ]);
    const { ctx } = makeCtx();

    const result = await registry.run("nope", {}, ctx);

    assert.deepEqual(result, { ok: false, message: "Unknown action: nope" });
    assert.equal(called, false);
  });

  it("lists schema problems and skips the handler", async () => {
    let called = false;
    const registry = createActionRegistry([
      action({}, async () => {
        called = true;
        return { ok: true, message: "" };
      }),
    ]);
    const { ctx } = makeCtx();

    const values = { note: "far too long a note", urgent: "yes", extra: 1 };

    const result = await registry.run("send_note", values, ctx);

    assert.equal(result.ok, false);
    assert.match(result.message, /^Invalid values for send_note: /);
    assert.match(result.message, /\/note must NOT have more than 10 characters/);
    assert.match(result.message, /\/urgent must be boolean/);
    assert.match(result.message, /\/extra is not allowed/);
    assert.equal(called, false);

    const missing = await registry.run("send_note", {}, ctx);
    assert.match(missing.message, /\/note is required/);
    assert.equal(called, false);
  });

  it("turns a throwing handler into a failure and logs it", async () => {
    const boom = new Error("boom");
    const registry = createActionRegistry([
      action({}, async () => {
        throw boom;
      }),
    ]);
    const { ctx, log } = makeCtx();

    const result = await registry.run("send_note", { note: "hi" }, ctx);

    assert.deepEqual(result, { ok: false, message: "That action failed." });
    assert.equal(log.errors.length, 1);
    assert.equal(log.errors[0]?.action, "send_note");
    assert.equal(log.errors[0]?.err, boom);
  });

  it("times out a slow handler and aborts its signal", async () => {
    let handlerSignal: AbortSignal | undefined;
    const registry = createActionRegistry(
      [
        action({}, (_values, ctx) => {
          handlerSignal = ctx.signal;
          // Rejects once aborted, like a fetch would.
          return new Promise((_resolve, reject) => {
            ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
          });
        }),
      ],
      { timeoutMs: 20 },
    );
    const { ctx } = makeCtx();

    const result = await registry.run("send_note", { note: "hi" }, ctx);

    assert.deepEqual(result, { ok: false, message: "That action took too long." });
    assert.equal(handlerSignal?.aborted, true);
  });

  it("aborts the handler's signal when the caller's signal aborts", async () => {
    const caller = new AbortController();
    let handlerSignal: AbortSignal | undefined;
    const registry = createActionRegistry(
      [
        action({}, async (_values, ctx) => {
          handlerSignal = ctx.signal;
          caller.abort();
          return { ok: true, message: "done" };
        }),
      ],
      { timeoutMs: 1000 },
    );
    const { ctx } = makeCtx(caller.signal);

    await registry.run("send_note", { note: "hi" }, ctx);

    assert.notEqual(handlerSignal, caller.signal);
    assert.equal(handlerSignal?.aborted, true);
  });

  it("cuts a long message to the limit", async () => {
    const long = "x".repeat(MAX_ACTION_MESSAGE_CHARS + 100);
    const registry = createActionRegistry([action({}, async () => ({ ok: true, message: long }))]);
    const { ctx } = makeCtx();

    const result = await registry.run("send_note", { note: "hi" }, ctx);

    assert.equal(MAX_ACTION_MESSAGE_CHARS, 500);
    assert.deepEqual(result, { ok: true, message: long.slice(0, 500) });
  });
});
