import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { createOpenAIComponentLlm, type JsonChatClient } from "./OpenAIComponentLlm";

function completion(
  content: string | null,
  finish: "stop" | "length" = "stop",
  usage?: { prompt_tokens: number; completion_tokens: number },
): ChatCompletion {
  return {
    id: "c",
    object: "chat.completion",
    created: 0,
    model: "test-model",
    choices: [{ index: 0, finish_reason: finish, logprobs: null, message: { role: "assistant", content, refusal: null } }],
    ...(usage ? { usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens } } : {}),
  };
}

function fakeClient(reply: ChatCompletion) {
  const calls: { body: ChatCompletionCreateParamsNonStreaming; signal: AbortSignal }[] = [];
  const client: JsonChatClient = {
    chat: {
      completions: {
        async create(body, options) {
          calls.push({ body, signal: options.signal });
          return reply;
        },
      },
    },
  };
  return { client, calls };
}

const messages = [
  { role: "system" as const, content: "rules" },
  { role: "user" as const, content: "hi" },
];

describe("createOpenAIComponentLlm", () => {
  it("asks for a JSON object with an output limit and no tools, passing the signal", async () => {
    const { client, calls } = fakeClient(completion("{}"));
    const llm = createOpenAIComponentLlm({ apiKey: "k", model: "m", maxOutputTokens: 777, client });
    const signal = new AbortController().signal;
    await llm.complete({ messages, signal });
    const { body } = calls[0]!;
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.max_completion_tokens, 777);
    assert.equal(body.model, "m");
    assert.deepEqual(body.messages, messages);
    assert.equal(body.tools, undefined);
    assert.equal(body.stream, undefined);
    assert.equal(calls[0]!.signal, signal);
  });

  it("maps content and usage", async () => {
    const { client } = fakeClient(completion('{"a":1}', "stop", { prompt_tokens: 10, completion_tokens: 4 }));
    const llm = createOpenAIComponentLlm({ apiKey: "k", model: "m", client });
    const reply = await llm.complete({ messages, signal: new AbortController().signal });
    assert.deepEqual(reply, { content: '{"a":1}', truncated: false, usage: { promptTokens: 10, completionTokens: 4 } });
  });

  it("marks a reply cut off by the length limit as truncated", async () => {
    const { client } = fakeClient(completion('{"tr', "length"));
    const llm = createOpenAIComponentLlm({ apiKey: "k", model: "m", client });
    const reply = await llm.complete({ messages, signal: new AbortController().signal });
    assert.equal(reply.truncated, true);
    assert.equal(reply.usage, undefined);
  });

  it("gives null content for an empty reply", async () => {
    const { client } = fakeClient(completion(null));
    const llm = createOpenAIComponentLlm({ apiKey: "k", model: "m", client });
    assert.equal((await llm.complete({ messages, signal: new AbortController().signal })).content, null);
  });
});
