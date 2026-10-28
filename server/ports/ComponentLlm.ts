export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

export interface LlmUsage {
  promptTokens: number;
  /** Of `promptTokens`, those served from the provider's prompt cache. */
  cachedPromptTokens?: number;
  completionTokens: number;
}

export interface LlmReply {
  /** The reply text; null when the model said nothing. */
  content: string | null;
  /** The reply was cut off at the output token limit. */
  truncated: boolean;
  usage?: LlmUsage;
}

/** One JSON-answering model call, with no tools. */
export interface ComponentLlm {
  complete(input: { messages: LlmMessage[]; signal: AbortSignal }): Promise<LlmReply>;
}
