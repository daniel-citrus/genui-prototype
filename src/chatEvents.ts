import type { AgentEvent } from "shared/api";

/** What an event adds to the thread; null for events the person doesn't see there. */
export type ThreadEffect = "text" | "notice" | "error" | null;

/** text → "text", notice → "notice", error → "error"; tool_call, tool_result, ui, done → null. */
export function threadEffect(event: AgentEvent): ThreadEffect {
  switch (event.type) {
    case "text":
    case "notice":
    case "error":
      return event.type;
    default:
      return null;
  }
}

/**
 * Whether the thinking indicator shows after `event`, given whether it showed before.
 * text → false; tool_call → true; done, error → false; tool_result, ui, notice → unchanged.
 */
export function thinkingAfter(thinking: boolean, event: AgentEvent): boolean {
  switch (event.type) {
    case "tool_call":
      return true;
    case "text":
    case "done":
    case "error":
      return false;
    default:
      return thinking;
  }
}
