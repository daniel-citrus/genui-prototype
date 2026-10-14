import OpenAI from "openai";
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "../../agent/guardrails";
import { createTurnAccumulator, toOpenAITools } from "../../agent/openaiTools";
import type { AgentLlm, LlmUsage } from "../../ports/AgentLlm";

/** The slice of the OpenAI SDK this adapter uses. A real `OpenAI` satisfies it. */
export interface ChatClient {
  chat: {
    completions: {
      create(
        body: ChatCompletionCreateParamsStreaming,
        options: { signal: AbortSignal },
      ): PromiseLike<AsyncIterable<ChatCompletionChunk>>;
    };
  };
}

/** The agent's LLM port, backed by streaming OpenAI Chat Completions. */
export function createOpenAILlm(opts: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  /** Output tokens allowed per completion. */
  maxOutputTokens?: number;
  /** SDK retries on 429/5xx (it honours retry-after). SDK default is 2. */
  maxRetries?: number;
  /** Injected client (tests); otherwise an `OpenAI` is built on first use. */
  client?: ChatClient;
}): AgentLlm {
  let client: ChatClient | undefined = opts.client;
  return {
    async complete({ messages, tools, allowTools = true, signal, onText }) {
      client ??= new OpenAI({
        apiKey: opts.apiKey,
        maxRetries: opts.maxRetries,
      });
      const stream = await client.chat.completions.create(
        {
          model: opts.model,
          messages: [
            { role: "system", content: opts.systemPrompt },
            ...(messages as ChatCompletionMessageParam[]),
          ],
          // The API rejects an empty tools array, so omit the key instead.
          ...(tools.length > 0 ? { tools: toOpenAITools(tools) } : {}),
          // Keep the list (history may hold tool calls) but forbid new ones.
          ...(tools.length > 0 && !allowTools
            ? { tool_choice: "none" as const }
            : {}),
          max_completion_tokens: opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal },
      );

      // Stream text out as it arrives; stitch tool-call fragments into one
      // turn. With include_usage the final chunk has no choices, only usage.
      const acc = createTurnAccumulator();
      let usage: LlmUsage | undefined;
      let truncated = false;
      for await (const chunk of stream) {
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
          };
        }
        if (chunk.choices?.[0]?.finish_reason === "length") truncated = true;
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) onText(delta.content);
        acc.apply(delta);
      }
      const finished = acc.finish();
      return {
        content: finished.content || null,
        toolCalls: finished.toolCalls,
        usage,
        ...(truncated ? { truncated } : {}),
      };
    },
  };
}
