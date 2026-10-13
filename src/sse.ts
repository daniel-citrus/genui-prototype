import type { AgentEvent } from "shared/api";

export interface SseParser {
  /** Feed the next chunk of the stream; returns the events it completed. */
  push(chunk: string): AgentEvent[];
}

/**
 * Incremental parser for the agent chat's SSE stream. Only `data:` fields
 * matter: each event's data lines are joined and parsed as one `AgentEvent`.
 * Comments, other fields, and blocks that aren't valid JSON are dropped.
 */
export function createSseParser(): SseParser {
  let buffer = "";

  return {
    push(chunk) {
      // A trailing "\r" stays in the buffer until the next chunk shows
      // whether it starts a "\r\n".
      buffer = (buffer + chunk).replace(/\r\n/g, "\n");
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      const events: AgentEvent[] = [];
      for (const block of blocks) {
        const event = parseBlock(block);
        if (event) events.push(event);
      }
      return events;
    },
  };
}

function parseBlock(block: string): AgentEvent | undefined {
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line === "data") {
      data.push("");
    } else if (line.startsWith("data:")) {
      const value = line.slice(5);
      data.push(value.startsWith(" ") ? value.slice(1) : value);
    }
  }
  if (data.length === 0) return undefined;

  try {
    const parsed: unknown = JSON.parse(data.join("\n"));
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { type?: unknown }).type === "string"
    ) {
      return parsed as AgentEvent;
    }
  } catch {
    // Malformed block: ignore it.
  }
  return undefined;
}
