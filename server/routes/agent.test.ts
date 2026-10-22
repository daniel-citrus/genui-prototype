import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { MAX_MESSAGE_CHARS, type AgentEvent } from "shared/api";
import { emptyToolRegistry } from "../agent/tools";
import { InMemoryTraceRepository } from "../ports/fakes/InMemoryTraceRepository";
import type { AgentLlm } from "../ports/AgentLlm";
import { agentRouter } from "./agent";

function buildApp(llm?: AgentLlm) {
  const app = Fastify();
  app.register(agentRouter, {
    prefix: "/api/agent",
    llm,
    tools: emptyToolRegistry,
    traces: new InMemoryTraceRepository(),
  });
  return app;
}

function parseSse(body: string): AgentEvent[] {
  return body
    .split("\n\n")
    .filter((chunk) => chunk.trim() !== "")
    .map((chunk) => {
      assert.ok(chunk.startsWith("data: "), `unexpected SSE chunk: ${chunk}`);
      return JSON.parse(chunk.slice("data: ".length)) as AgentEvent;
    });
}

describe("POST /api/agent/chat", () => {
  it("streams a scripted reply as SSE text events, then done", async () => {
    const offered: unknown[] = [];
    const llm: AgentLlm = {
      async complete({ tools, onText }) {
        offered.push(tools);
        onText("Hello ");
        onText("there.");
        return { content: "Hello there.", toolCalls: [] };
      },
    };
    const app = buildApp(llm);
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: { conversationId: "route-reply", message: "  hi  " },
    });
    await app.close();

    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers["content-type"]), /^text\/event-stream/);
    assert.equal(res.headers["cache-control"], "no-cache, no-transform");
    assert.deepEqual(parseSse(res.body), [
      { type: "text", text: "Hello " },
      { type: "text", text: "there." },
      { type: "done" },
    ]);
    // The empty registry offers the model no tools.
    assert.deepEqual(offered, [[]]);
  });

  it("streams one error naming OPENAI_API_KEY when no llm is configured", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: { conversationId: "route-no-llm", message: "hi" },
    });
    await app.close();

    assert.equal(res.statusCode, 200);
    const events = parseSse(res.body);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "error");
    assert.match((events[0] as { message: string }).message, /OPENAI_API_KEY/);
  });

  it("answers 400 when the message is missing or blank", async () => {
    const app = buildApp();
    for (const payload of [
      { conversationId: "route-bad" },
      { conversationId: "route-bad", message: "   " },
      { message: "hi" },
    ]) {
      const res = await app.inject({ method: "POST", url: "/api/agent/chat", payload });
      assert.equal(res.statusCode, 400);
      assert.equal(typeof res.json().error.message, "string");
    }
    await app.close();
  });

  it("aborts the turn when the client closes the response", async () => {
    let resolveStarted!: () => void;
    const started = new Promise<void>((r) => (resolveStarted = r));
    let resolveAborted!: () => void;
    const aborted = new Promise<void>((r) => (resolveAborted = r));
    const llm: AgentLlm = {
      complete({ signal }) {
        signal.addEventListener("abort", () => resolveAborted());
        resolveStarted();
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      },
    };
    const app = buildApp(llm);
    const address = await app.listen({ port: 0, host: "127.0.0.1" });

    const client = new AbortController();
    const response = fetch(`${address}/api/agent/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: "route-close", message: "hi" }),
      signal: client.signal,
    });
    await started;
    client.abort();
    await assert.rejects(response.then((r) => r.text()));
    await aborted;
    await app.close();
  });

  describe("message length", () => {
    const send = async (message: string) => {
      let calls = 0;
      const llm: AgentLlm = {
        async complete() {
          calls++;
          return { content: "ok", toolCalls: [] };
        },
      };
      const app = buildApp(llm);
      const res = await app.inject({
        method: "POST",
        url: "/api/agent/chat",
        payload: { conversationId: "route-length", message },
      });
      await app.close();
      return { res, calls };
    };

    it("accepts exactly 4,000 characters, ignoring surrounding whitespace", async () => {
      for (const message of ["a".repeat(MAX_MESSAGE_CHARS), `  ${"a".repeat(MAX_MESSAGE_CHARS)}  `]) {
        const { res, calls } = await send(message);
        assert.equal(res.statusCode, 200);
        assert.equal(calls, 1);
      }
    });

    it("accepts 2,000 emoji (4,000 UTF-16 units)", async () => {
      const { res, calls } = await send("\u{1F600}".repeat(2000));
      assert.equal(res.statusCode, 200);
      assert.equal(calls, 1);
    });

    it("rejects 4,001 characters with a 400 and never calls the llm", async () => {
      const { res, calls } = await send("a".repeat(MAX_MESSAGE_CHARS + 1));
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error.message, "Message is too long (max 4000 characters).");
      assert.equal(calls, 0);
    });
  });
});
