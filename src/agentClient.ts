import type { AgentChatRequest, AgentEvent } from "shared/api";
import { createSseParser } from "./sse";

/**
 * Posts one chat turn and streams the agent's events to `onEvent`. Failures
 * surface as a single `error` event; aborting via `signal` resolves quietly
 * (and closes the stream, which stops the turn on the server).
 */
export async function streamChat(
  req: AgentChatRequest,
  onEvent: (e: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });
  } catch {
    if (!signal.aborted) {
      onEvent({ type: "error", message: "Couldn't reach the agent service." });
    }
    return;
  }

  try {
    if (!response.ok) {
      onEvent({ type: "error", message: await errorMessage(response) });
      return;
    }
    if (!response.body) {
      onEvent({ type: "error", message: "The agent service sent no response." });
      return;
    }

    const parser = createSseParser();
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        onEvent(event);
      }
    }
    for (const event of parser.push(decoder.decode())) onEvent(event);
  } catch (err) {
    if (signal.aborted) return;
    onEvent({
      type: "error",
      message: err instanceof Error ? err.message : "The response stream failed.",
    });
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body?.error?.message === "string" && body.error.message) {
      return body.error.message;
    }
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return `Request failed (${response.status})`;
}
