import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolResult } from "shared/api";
import { createToolRegistry, MAX_RESULT_DATA_CHARS } from "./registry";
import { emptyToolRegistry, type ToolContext, type ToolDefinition, type ToolLogger } from "./tools";

interface LogEntry {
  level: "debug" | "error";
  obj: Record<string, unknown>;
  msg?: string;
}

function recordingLogger(): ToolLogger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    entries,
    info() {},
    debug(obj, msg) {
      entries.push({ level: "debug", obj: obj as Record<string, unknown>, msg });
    },
    error(obj, msg) {
      entries.push({ level: "error", obj: obj as Record<string, unknown>, msg });
    },
  };
}

function makeCtx(signal = new AbortController().signal) {
  const log = recordingLogger();
  const ctx: ToolContext = { signal, log };
  return { ctx, log };
}

const closedSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    count: { type: "integer" },
    url: { type: "string", format: "uri" },
  },
  required: ["name"],
  additionalProperties: false,
};

function tool(
  overrides: Partial<ToolDefinition> = {},
  run: ToolDefinition["run"] = async (args) => ({ ok: true, summary: "done", data: args }),
): ToolDefinition {
  return {
    name: "get_thing",
    description: "Get a thing.",
    input_schema: closedSchema,
    run,
    ...overrides,
  };
}

describe("createToolRegistry construction", () => {
  it("lists specs in order without handlers", () => {
    const registry = createToolRegistry([tool({ name: "b_tool" }), tool({ name: "a_tool" })]);
    assert.deepEqual(registry.specs, [
      { name: "b_tool", description: "Get a thing.", input_schema: closedSchema },
      { name: "a_tool", description: "Get a thing.", input_schema: closedSchema },
    ]);
  });

  it("throws on a duplicate name", () => {
    assert.throws(() => createToolRegistry([tool(), tool()]), /Duplicate tool name "get_thing"/);
  });

  it("throws on a name that is not snake_case", () => {
    assert.throws(() => createToolRegistry([tool({ name: "List-Components" })]), /snake_case/);
    assert.throws(() => createToolRegistry([tool({ name: "listComponents" })]), /snake_case/);
    assert.throws(() => createToolRegistry([tool({ name: "1_tool" })]), /snake_case/);
  });

  it("throws on an invalid schema", () => {
    assert.throws(
      () =>
        createToolRegistry([
          tool({
            input_schema: {
              type: "object",
              properties: { name: { type: "strng" } },
              additionalProperties: false,
            },
          }),
        ]),
      /invalid input_schema/,
    );
    // Strict mode: unknown keywords are rejected.
    assert.throws(
      () =>
        createToolRegistry([
          tool({
            input_schema: {
              type: "object",
              properties: { name: { type: "string", bogus: true } },
              additionalProperties: false,
            },
          }),
        ]),
      /invalid input_schema/,
    );
  });

  it("throws on a schema that is not a closed object", () => {
    const open = { type: "object", properties: { name: { type: "string" } } };
    assert.throws(() => createToolRegistry([tool({ input_schema: open })]), /additionalProperties/);
    assert.throws(
      () =>
        createToolRegistry([
          tool({ input_schema: { type: "string", additionalProperties: false } }),
        ]),
      /type "object"/,
    );
  });

  it("the empty registry has no specs and reports unknown tools", async () => {
    assert.deepEqual(emptyToolRegistry.specs, []);
    const { ctx } = makeCtx();
    assert.deepEqual(await emptyToolRegistry.run("anything", {}, ctx), {
      ok: false,
      summary: "Unknown tool: anything",
    });
  });
});

describe("createToolRegistry run", () => {
  it("runs a handler with valid args and logs its duration", async () => {
    const registry = createToolRegistry([tool()]);
    const { ctx, log } = makeCtx();
    const args = { name: "x", count: 2, url: "https://example.com/a" };

    const result = await registry.run("get_thing", args, ctx);

    assert.deepEqual(result, { ok: true, summary: "done", data: args });
    assert.equal(log.entries.length, 1);
    const [entry] = log.entries;
    assert.equal(entry.level, "debug");
    assert.equal(entry.obj.tool, "get_thing");
    assert.equal(entry.obj.ok, true);
    assert.equal(typeof entry.obj.durationMs, "number");
  });

  it("returns ok: false for an unknown tool", async () => {
    const registry = createToolRegistry([tool()]);
    const { ctx } = makeCtx();
    assert.deepEqual(await registry.run("nope", {}, ctx), {
      ok: false,
      summary: "Unknown tool: nope",
    });
  });

  it("rejects args that fail the schema, without running the handler", async () => {
    let ran = 0;
    const registry = createToolRegistry([
      tool({}, async () => {
        ran++;
        return { ok: true, summary: "done" };
      }),
    ]);
    const { ctx } = makeCtx();

    const cases: Array<[Record<string, unknown>, Array<{ path: string; message: string }>]> = [
      [{}, [{ path: "/name", message: "is required" }]],
      [{ name: 5 }, [{ path: "/name", message: "must be string" }]],
      [{ name: "x", extra: true }, [{ path: "/extra", message: "is not allowed" }]],
      [{ name: "x", url: "not a uri" }, [{ path: "/url", message: 'must match format "uri"' }]],
    ];
    for (const [args, errors] of cases) {
      const result = await registry.run("get_thing", args, ctx);
      assert.deepEqual(result, {
        ok: false,
        summary: "Invalid arguments for get_thing",
        data: { errors },
      });
    }
    assert.equal(ran, 0);
  });

  it("reports every schema error at once", async () => {
    const registry = createToolRegistry([tool()]);
    const { ctx } = makeCtx();
    const result = await registry.run("get_thing", { count: "two", extra: 1 }, ctx);
    const errors = (result.data as { errors: unknown[] }).errors;
    assert.equal(errors.length, 3);
  });

  it("turns a throwing handler into ok: false, logging but not returning the error", async () => {
    const registry = createToolRegistry([
      tool({}, async () => {
        throw new Error("secret database detail");
      }),
    ]);
    const { ctx, log } = makeCtx();

    const result = await registry.run("get_thing", { name: "x" }, ctx);

    assert.deepEqual(result, { ok: false, summary: "get_thing failed" });
    assert.equal(JSON.stringify(result).includes("secret database detail"), false);
    const error = log.entries.find((e) => e.level === "error");
    assert.ok(error);
    assert.equal(error.obj.tool, "get_thing");
    assert.equal((error.obj.err as Error).message, "secret database detail");
    const debug = log.entries.find((e) => e.level === "debug");
    assert.equal(debug?.obj.ok, false);
  });

  it("hands the handler the turn's abort signal and logger", async () => {
    const seen: ToolContext[] = [];
    const registry = createToolRegistry([
      tool({}, async (_args, ctx) => {
        seen.push(ctx);
        return { ok: true, summary: "done" };
      }),
    ]);
    const controller = new AbortController();
    const { ctx, log } = makeCtx(controller.signal);

    await registry.run("get_thing", { name: "x" }, ctx);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].log, log);
    assert.equal(seen[0].signal.aborted, false);
    controller.abort();
    assert.equal(seen[0].signal.aborted, true);
  });

  it("replaces oversized data with a truncation note", async () => {
    const big = "x".repeat(MAX_RESULT_DATA_CHARS);
    const registry = createToolRegistry([
      tool({}, async (args): Promise<ToolResult> => ({
        ok: true,
        summary: "big",
        data: { text: args.name === "big" ? big : "small" },
      })),
    ]);
    const { ctx } = makeCtx();

    assert.deepEqual(await registry.run("get_thing", { name: "big" }, ctx), {
      ok: true,
      summary: "big",
      data: { truncated: true, note: "Result too large to return" },
    });
    assert.deepEqual(await registry.run("get_thing", { name: "small" }, ctx), {
      ok: true,
      summary: "big",
      data: { text: "small" },
    });
  });

  it("passes data of exactly the limit through", async () => {
    // JSON.stringify of a string adds two quote characters.
    const exact = "y".repeat(MAX_RESULT_DATA_CHARS - 2);
    const registry = createToolRegistry([
      tool({}, async () => ({ ok: true, summary: "exact", data: exact })),
    ]);
    const { ctx } = makeCtx();
    const result = await registry.run("get_thing", { name: "x" }, ctx);
    assert.equal(result.data, exact);
  });
});
