/**
 * The client ⇄ server wire contract for the agent chat. The chat pane and the
 * API's agent route are the two ends of this.
 */

import type { UiNode } from "./ui";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  /** Human-readable line shown in the transcript. */
  summary: string;
  /** Structured payload handed back to the model. */
  data?: unknown;
}

/** Longest chat message, in UTF-16 code units (the unit of a textarea's `maxlength`). */
export const MAX_MESSAGE_CHARS = 4000;

/** `POST /api/agent/chat` request body. */
export interface AgentChatRequest {
  /** Client-generated; the server keeps that conversation's history. */
  conversationId: string;
  message: string;
  /**
   * True when the chat already shows earlier messages of this conversation,
   * so the agent can say so if the server no longer has them.
   */
  resume?: boolean;
}

/**
 * Events streamed from `POST /api/agent/chat` (SSE, one JSON object per
 * `data:` line).
 */
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "tool_result"; call: ToolCall; result: ToolResult }
  | { type: "ui"; tree: UiNode }
  | { type: "notice"; message: string }
  | { type: "done" }
  | { type: "error"; message: string };
