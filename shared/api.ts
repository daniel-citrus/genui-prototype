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
  /** `id` is random per design; an action request names the design by it. */
  | { type: "ui"; id: string; tree: UiNode }
  | { type: "notice"; message: string }
  | { type: "done" }
  | { type: "error"; message: string };

/** Longest text value an action input may send. */
export const MAX_FIELD_CHARS = 1000;

/** `POST /api/actions/run` request body: a click on a Button with an action. */
export interface ActionRunRequest {
  conversationId: string;
  /** The `id` of the `ui` event that drew the design. */
  uiId: string;
  action: string;
  /** Named input values; password fields never included. */
  values: Record<string, string | boolean>;
  /** The person said yes to the action's confirm question. */
  confirmed?: boolean;
}

/** What an action reports back; `message` is shown to the person. */
export interface ActionResult {
  ok: boolean;
  message: string;
  /** The action did not run: ask this, then resend with confirmed: true. */
  confirm?: string;
}
