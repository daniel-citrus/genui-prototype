import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "../../agent/guardrails";
import type { ComponentLlm } from "../../ports/ComponentLlm";

/** The slice of the OpenAI SDK this adapter uses. A real `OpenAI` satisfies it. */
export interface JsonChatClient {
  chat: {
    completions: {
      create(
        body: ChatCompletionCreateParamsNonStreaming,
        options: { signal: AbortSignal },
      ): PromiseLike<ChatCompletion>;
    };
  };
}

/** The generator's LLM port, backed by one non-streaming OpenAI Chat Completions call in JSON mode. */
export function createOpenAIComponentLlm(opts: {
  apiKey: string;
  model: string;
  /** Output tokens allowed per completion. */
  maxOutputTokens?: number;
  /** SDK retries on 429/5xx (it honours retry-after). SDK default is 2. */
  maxRetries?: number;
  /** Injected client (tests); otherwise an `OpenAI` is built on first use. */
  client?: JsonChatClient;
}): ComponentLlm {
  let client: JsonChatClient | undefined = opts.client;
  return {
    async complete({ messages, signal }) {
      client ??= new OpenAI({ apiKey: opts.apiKey, maxRetries: opts.maxRetries });
      const completion = await client.chat.completions.create(
        {
          model: opts.model,
          messages,
          response_format: { type: "json_object" },
          max_completion_tokens: opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        },
        { signal },
      );
      const choice = completion.choices[0];
      return {
        content: choice?.message.content || null,
        truncated: choice?.finish_reason === "length",
        ...(completion.usage
          ? {
              usage: {
                promptTokens: completion.usage.prompt_tokens,
                completionTokens: completion.usage.completion_tokens,
              },
            }
          : {}),
      };
    },
  };
}
