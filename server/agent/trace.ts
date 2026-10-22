import type { ToolCall, ToolResult } from "shared/api";
import type { UiNode } from "shared/ui";
import type { LlmUsage } from "../ports/AgentLlm";

export type EndedBy = "reply" | "max_steps" | "tool_budget" | "token_budget" | "stopped";

export type ToolSkipReason = "budget" | "duplicate" | "stopped";

export interface AgentTraceToolCall {
  call: ToolCall;
  result: ToolResult;
  skipped?: ToolSkipReason;
  ui?: { id: string; tree: UiNode };
}

export interface AgentTraceCompletion {
  allowTools: boolean;
  content: string | null;
  truncated: boolean;
  usage?: LlmUsage;
  toolCalls: AgentTraceToolCall[];
}

export interface AgentTrace {
  conversationId: string;
  userText: string;
  endedBy: EndedBy;
  steps: number;
  toolCalls: number;
  promptTokens: number;
  completionTokens: number;
  completions: AgentTraceCompletion[];
  error?: string;
}
