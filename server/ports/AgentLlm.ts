import type { ToolSpec } from "../agent/tools";

/** One message of a conversation's history, in Chat Completions shape. */
export type HistoryMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

/** One completed model turn: its text and the tool calls it asked for. */
export interface LlmTurn {
  content: string | null;
  /** `arguments` is the raw JSON string the model produced. */
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  usage?: LlmUsage;
  /** The reply was cut off by the output-token limit. */
  truncated?: boolean;
}

/** The language model behind the agent loop. */
export interface AgentLlm {
  /**
   * Runs one turn over `messages`, calling `onText` with each streamed text
   * fragment, and resolves with the whole turn.
   */
  complete(input: {
    messages: HistoryMessage[];
    tools: ToolSpec[];
    /**
     * When false the model may not call tools (default true). The tool list is
     * still sent: earlier tool calls in `messages` refer to it.
     */
    allowTools?: boolean;
    signal: AbortSignal;
    onText(text: string): void;
  }): Promise<LlmTurn>;
}
