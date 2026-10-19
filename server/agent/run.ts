import { randomUUID } from "node:crypto";
import type { AgentEvent, ToolCall } from "shared/api";
import type { ToolLogger, ToolRegistry } from "./tools";

/** Everything a turn needs, wired up by the `/api/agent/chat` route. */
export interface AgentRun {
  emit(event: AgentEvent): void;
  signal: AbortSignal;
  tools: ToolRegistry;
  /** The request's logger, handed to tools. */
  log: ToolLogger;
  /** The chat already shows earlier messages of this conversation. */
  resume?: boolean;
}

/** What the model is told after a tool ran (or didn't). */
export interface ToolOutcome {
  content: string;
  isError: boolean;
}

/**
 * The per-tool-call path: announce → execute → report. Emits `tool_call` and
 * `tool_result` events.
 */
export async function handleToolCall(
  run: AgentRun,
  call: ToolCall,
): Promise<ToolOutcome> {
  run.emit({ type: "tool_call", call });

  // After Stop, the rest of the step's calls are answered without running:
  // the history keeps a result for each, and nothing else changes.
  if (run.signal.aborted) {
    const summary = "Stopped before this ran.";
    run.emit({ type: "tool_result", call, result: { ok: false, summary } });
    return {
      content: "The user stopped this turn before this ran. Only run it again if they ask.",
      isError: true,
    };
  }

  const result = await run.tools.run(call.name, call.args, {
    signal: run.signal,
    log: run.log,
    showUi: (tree) => run.emit({ type: "ui", id: randomUUID(), tree }),
  });
  run.emit({ type: "tool_result", call, result });
  return {
    content: JSON.stringify({ summary: result.summary, data: result.data }),
    isError: !result.ok,
  };
}
