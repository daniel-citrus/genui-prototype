import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSseParser } from "./sse";

describe("createSseParser", () => {
  it("parses a single complete event", () => {
    const parser = createSseParser();
    assert.deepEqual(parser.push('data: {"type":"text","text":"hi"}\n\n'), [
      { type: "text", text: "hi" },
    ]);
  });

  it("buffers chunks split mid-line and mid-JSON", () => {
    const parser = createSseParser();
    assert.deepEqual(parser.push("da"), []);
    assert.deepEqual(parser.push('ta: {"type":"te'), []);
    assert.deepEqual(parser.push('xt","text":"hel'), []);
    assert.deepEqual(parser.push('lo"}\n'), []);
    assert.deepEqual(parser.push("\n"), [{ type: "text", text: "hello" }]);
  });

  it("returns several events from one chunk", () => {
    const parser = createSseParser();
    const chunk =
      'data: {"type":"text","text":"a"}\n\n' +
      'data: {"type":"notice","message":"n"}\n\n' +
      'data: {"type":"done"}\n\n';
    assert.deepEqual(parser.push(chunk), [
      { type: "text", text: "a" },
      { type: "notice", message: "n" },
      { type: "done" },
    ]);
  });

  it("handles CRLF separators, including a CRLF split across chunks", () => {
    const parser = createSseParser();
    assert.deepEqual(
      parser.push('data: {"type":"text","text":"a"}\r\n\r\ndata: {"type":"done"}\r'),
      [{ type: "text", text: "a" }],
    );
    assert.deepEqual(parser.push("\n\r\n"), [{ type: "done" }]);
  });

  it("joins multiple data lines of one event", () => {
    const parser = createSseParser();
    assert.deepEqual(
      parser.push('data: {"type":"error",\ndata: "message":"boom"}\n\n'),
      [{ type: "error", message: "boom" }],
    );
  });

  it("ignores comments, non-data fields, and malformed blocks", () => {
    const parser = createSseParser();
    const chunk =
      ": keep-alive\n\n" +
      "event: ping\nid: 1\n\n" +
      "data: {not json\n\n" +
      'data: "just a string"\n\n' +
      ': comment\nevent: message\ndata: {"type":"done"}\n\n';
    assert.deepEqual(parser.push(chunk), [{ type: "done" }]);
  });

  it("keeps an unterminated event buffered", () => {
    const parser = createSseParser();
    assert.deepEqual(parser.push('data: {"type":"done"}\n'), []);
  });
});
