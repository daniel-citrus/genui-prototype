import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import type { ToolSpec } from "../../agent/tools";
import type { HistoryMessage } from "../../ports/AgentLlm";
import { createOpenAILlm, type ChatClient } from "./OpenAILlm";

type Delta = ChatCompletionChunk.Choice.Delta;

function deltaChunk(delta: Delta): ChatCompletionChunk {
  return {
    id: "chunk",
    object: "chat.completion.chunk",
    created: 0,
    model: "test-model",
    choices: [{ index: 0, delta, finish_reason: null }],
  };
}

function finishChunk(reason: "stop" | "length"): ChatCompletionChunk {
  return {
    id: "chunk",
    object: "chat.completion.chunk",
    created: 0,
    model: "test-model",
    choices: [{ index: 0, delta: {}, finish_reason: reason }],
  };
}

function usageChunk(prompt: number, completion: number): ChatCompletionChunk {
  return {
    id: "chunk",
    object: "chat.completion.chunk",
    created: 0,
    model: "test-model",
    choices: [],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
    },
  };
}

/** A client that records each request and streams the scripted chunks. */
function fakeClient(chunks: ChatCompletionChunk[]) {
  const calls: Array<{
    body: ChatCompletionCreateParamsStreaming;
    options: { signal: AbortSignal };
  }> = [];
  const client: ChatClient = {
    chat: {
      completions: {
        async create(body, options) {
          calls.push({ body, options });
          return (async function* () {
            yield* chunks;
          })();
        },
      },
    },
  };
  return { client, calls };
}

const spec: ToolSpec = {
  name: "list_components",
  description: "List every saved component.",
  input_schema: { type: "object", properties: {} },
};

function makeLlm(client: ChatClient, maxOutputTokens?: number) {
  return createOpenAILlm({
    apiKey: "unused",
    model: "test-model",
    systemPrompt: "You are a test.",
    maxOutputTokens,
    client,
  });
}

describe("createOpenAILlm", () => {
  it("sends the system prompt first, then the history in order, streaming with usage", async () => {
    const { client, calls } = fakeClient([deltaChunk({ content: "ok" })]);
    const history: HistoryMessage[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "list_components", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "[]" },
    ];
    await makeLlm(client).complete({
      messages: history,
      tools: [],
      signal: new AbortController().signal,
      onText: () => {},
    });

    assert.equal(calls.length, 1);
    const { body } = calls[0];
    assert.equal(body.model, "test-model");
    assert.equal(body.stream, true);
    assert.deepEqual(body.stream_options, { include_usage: true });
    assert.deepEqual(body.messages, [
      { role: "system", content: "You are a test." },
      ...history,
    ]);
  });

  it("omits tools when empty and converts them when given", async () => {
    const empty = fakeClient([]);
    await makeLlm(empty.client).complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      signal: new AbortController().signal,
      onText: () => {},
    });
    assert.equal("tools" in empty.calls[0].body, false);

    const one = fakeClient([]);
    await makeLlm(one.client).complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [spec],
      signal: new AbortController().signal,
      onText: () => {},
    });
    assert.deepEqual(one.calls[0].body.tools, [
      {
        type: "function",
        function: {
          name: spec.name,
          description: spec.description,
          parameters: spec.input_schema,
        },
      },
    ]);
  });

  it("streams each text delta to onText and returns their concatenation", async () => {
    const { client } = fakeClient([
      deltaChunk({ role: "assistant", content: "" }),
      deltaChunk({ content: "Hel" }),
      deltaChunk({ content: "lo" }),
      deltaChunk({ content: "!" }),
    ]);
    const seen: string[] = [];
    const turn = await makeLlm(client).complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      signal: new AbortController().signal,
      onText: (text) => seen.push(text),
    });
    assert.deepEqual(seen, ["Hel", "lo", "!"]);
    assert.equal(turn.content, "Hello!");
    assert.deepEqual(turn.toolCalls, []);
    assert.equal(turn.usage, undefined);
  });

  it("reassembles fragmented tool calls, returns null content, and reports usage", async () => {
    const { client } = fakeClient([
      deltaChunk({
        tool_calls: [
          {
            index: 0,
            id: "call_1",
            type: "function",
            function: { name: "rename_", arguments: "" },
          },
        ],
      }),
      deltaChunk({
        tool_calls: [{ index: 0, function: { name: "component", arguments: '{"id":' } }],
      }),
      deltaChunk({
        tool_calls: [{ index: 0, function: { arguments: '"c1","name":"X"}' } }],
      }),
      usageChunk(12, 5),
    ]);
    const seen: string[] = [];
    const turn = await makeLlm(client).complete({
      messages: [{ role: "user", content: "rename it" }],
      tools: [spec],
      signal: new AbortController().signal,
      onText: (text) => seen.push(text),
    });
    assert.deepEqual(seen, []);
    assert.equal(turn.content, null);
    assert.deepEqual(turn.toolCalls, [
      { id: "call_1", name: "rename_component", arguments: '{"id":"c1","name":"X"}' },
    ]);
    assert.deepEqual(turn.usage, { promptTokens: 12, completionTokens: 5 });
  });

  it("passes the signal to create", async () => {
    const { client, calls } = fakeClient([]);
    const controller = new AbortController();
    await makeLlm(client).complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      signal: controller.signal,
      onText: () => {},
    });
    assert.equal(calls[0].options.signal, controller.signal);
  });

  it("keeps tools but forbids calling them when allowTools is false", async () => {
    const off = fakeClient([]);
    await makeLlm(off.client).complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [spec],
      allowTools: false,
      signal: new AbortController().signal,
      onText: () => {},
    });
    assert.equal(off.calls[0].body.tool_choice, "none");
    assert.equal(off.calls[0].body.tools?.length, 1);

    const on = fakeClient([]);
    await makeLlm(on.client).complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [spec],
      signal: new AbortController().signal,
      onText: () => {},
    });
    assert.equal("tool_choice" in on.calls[0].body, false);

    // With no tools there is nothing to forbid.
    const none = fakeClient([]);
    await makeLlm(none.client).complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      allowTools: false,
      signal: new AbortController().signal,
      onText: () => {},
    });
    assert.equal("tool_choice" in none.calls[0].body, false);
  });

  it("sends the configured output limit as max_completion_tokens", async () => {
    const { client, calls } = fakeClient([]);
    await makeLlm(client, 512).complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      signal: new AbortController().signal,
      onText: () => {},
    });
    assert.equal(calls[0].body.max_completion_tokens, 512);

    const dflt = fakeClient([]);
    await makeLlm(dflt.client).complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      signal: new AbortController().signal,
      onText: () => {},
    });
    assert.equal(dflt.calls[0].body.max_completion_tokens, 4096);
  });

  it("marks a turn truncated only when finish_reason is length", async () => {
    const run = async (reason: "stop" | "length") => {
      const { client } = fakeClient([deltaChunk({ content: "hi" }), finishChunk(reason)]);
      return makeLlm(client).complete({
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        signal: new AbortController().signal,
        onText: () => {},
      });
    };
    assert.equal((await run("length")).truncated, true);
    assert.notEqual((await run("stop")).truncated, true);
  });

  it("does not build an SDK client until first use", () => {
    // No client injected and no network: construction alone must not throw
    // or reach out; the SDK client is created lazily inside complete().
    const llm = createOpenAILlm({ apiKey: "", model: "m", systemPrompt: "s" });
    assert.equal(typeof llm.complete, "function");
  });
});
