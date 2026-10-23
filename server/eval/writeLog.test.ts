import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AgentTrace } from "../agent/trace";
import {
  createEvalLogDir,
  evalLogDirName,
  writeEvalCaseLog,
  type EvalCaseLog,
} from "./writeLog";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "eval-log-writer-"));
}

function sampleTrace(overrides: Partial<AgentTrace> = {}): AgentTrace {
  const tree = {
    component: "Heading",
    props: { text: "Hello" },
    children: [{ component: "Text", props: { value: "nested" } }],
  };
  return {
    conversationId: "eval:sample:00000000-0000-4000-8000-000000000001",
    userText: "Show a heading",
    endedBy: "reply",
    steps: 2,
    toolCalls: 1,
    promptTokens: 100,
    completionTokens: 50,
    completions: [
      {
        allowTools: true,
        content: "Here is your UI.",
        truncated: false,
        toolCalls: [
          {
            call: {
              id: "call_ui",
              name: "render_ui",
              args: { tree, limit: 3, meta: { q: "x" } },
            },
            result: { ok: true, summary: "Rendered UI" },
            ui: { id: "ui-1", tree },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function baseLog(overrides: Partial<EvalCaseLog> = {}): EvalCaseLog {
  return {
    id: "simple-heading",
    prompt: "Show a heading that says Hello",
    checks: [{ toolSucceeded: "render_ui" }, { uiComponent: "Heading" }],
    ok: true,
    failures: [],
    endedBy: "reply",
    trace: sampleTrace(),
    ...overrides,
  };
}

describe("evalLogDirName", () => {
  it("formats ISO time as one path segment", () => {
    const name = evalLogDirName(new Date("2026-10-22T12:31:05.123Z"));
    assert.equal(name, "2026-10-22T12-31-05.123Z");
    assert.equal(name.includes("/"), false);
    assert.equal(name.includes(":"), false);
  });
});

describe("createEvalLogDir", () => {
  it("creates root and a timestamped directory", () => {
    const root = tempRoot();
    const now = new Date("2026-10-22T12:31:05.123Z");
    const dir = createEvalLogDir(root, now);
    assert.equal(dir, join(root, "2026-10-22T12-31-05.123Z"));
    assert.equal(existsSync(dir), true);
  });

  it("throws when the same root and Date are used twice", () => {
    const root = tempRoot();
    const now = new Date("2026-10-22T12:31:05.123Z");
    const first = createEvalLogDir(root, now);
    assert.throws(() => createEvalLogDir(root, now));
    assert.equal(existsSync(first), true);
  });
});

describe("writeEvalCaseLog", () => {
  it("writes UTF-8 JSON with key order and trailing newline", () => {
    const dir = tempRoot();
    const log = baseLog();
    writeEvalCaseLog(dir, log);

    const raw = readFileSync(join(dir, "simple-heading.json"), "utf8");
    assert.equal(raw.endsWith("\n"), true);
    assert.match(raw, /^\{\n  "id":/);

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed), [
      "id",
      "prompt",
      "checks",
      "ok",
      "failures",
      "endedBy",
      "trace",
    ]);
    assert.equal(parsed.id, log.id);
    assert.equal(parsed.prompt, log.prompt);
    assert.deepEqual(parsed.checks, log.checks);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.failures, []);
    assert.equal(parsed.endedBy, "reply");
    assert.equal("error" in parsed, false);
    assert.equal("apiKey" in parsed, false);
  });

  it("round-trips completion content, tool args, and ui", () => {
    const dir = tempRoot();
    writeEvalCaseLog(dir, baseLog());

    const parsed = JSON.parse(readFileSync(join(dir, "simple-heading.json"), "utf8")) as {
      trace: AgentTrace;
    };
    const completion = parsed.trace.completions[0]!;
    assert.equal(completion.content, "Here is your UI.");
    const toolCall = completion.toolCalls[0]!;
    assert.deepEqual(toolCall.call.args, {
      tree: {
        component: "Heading",
        props: { text: "Hello" },
        children: [{ component: "Text", props: { value: "nested" } }],
      },
      limit: 3,
      meta: { q: "x" },
    });
    assert.deepEqual(toolCall.ui, {
      id: "ui-1",
      tree: toolCall.call.args.tree,
    });
  });

  it("includes error and omits endedBy when only error is set on the log", () => {
    const dir = tempRoot();
    const log = baseLog({
      endedBy: undefined,
      error: "boom",
      ok: false,
      trace: sampleTrace({ error: "boom", endedBy: "stopped" }),
    });
    writeEvalCaseLog(dir, log);

    const parsed = JSON.parse(readFileSync(join(dir, "simple-heading.json"), "utf8")) as Record<
      string,
      unknown
    >;
    assert.deepEqual(Object.keys(parsed), [
      "id",
      "prompt",
      "checks",
      "ok",
      "failures",
      "error",
      "trace",
    ]);
    assert.equal(parsed.error, "boom");
    assert.equal("endedBy" in parsed, false);
  });

  it("refuses non-kebab ids before writing", () => {
    const dir = tempRoot();
    for (const id of ["Bad_Case", "../escape", "a/b", ".."]) {
      assert.throws(
        () =>
          writeEvalCaseLog(dir, baseLog({ id })),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.equal(err.message, "eval log id must be kebab-case");
          return true;
        },
      );
    }
    assert.deepEqual(readdirSync(dir), []);
  });

  it("throws on duplicate write and leaves the first file unchanged", () => {
    const dir = tempRoot();
    const log = baseLog();
    writeEvalCaseLog(dir, log);
    const before = readFileSync(join(dir, "simple-heading.json"), "utf8");

    assert.throws(() => writeEvalCaseLog(dir, log));
    const after = readFileSync(join(dir, "simple-heading.json"), "utf8");
    assert.equal(after, before);
  });
});

describe("writeEvalCaseLog attempt", () => {
  it("writes <id>.<attempt>.json", () => {
    const dir = tempRoot();
    writeEvalCaseLog(dir, baseLog(), 1);
    assert.deepEqual(readdirSync(dir), ["simple-heading.1.json"]);
  });

  it("refuses attempts outside 1 to 10 before writing", () => {
    const dir = tempRoot();
    for (const attempt of [0, 11, 1.5]) {
      assert.throws(() => writeEvalCaseLog(dir, baseLog(), attempt), /attempt/);
    }
    assert.deepEqual(readdirSync(dir), []);
  });
});
