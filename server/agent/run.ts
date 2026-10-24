import { randomUUID } from "node:crypto";
import type { AgentEvent, ToolCall } from "shared/api";
import type { TraceRepository } from "../ports/TraceRepository";
import { rememberDesign } from "./conversations";
import type { ToolLogger, ToolRegistry } from "./tools";

/** Everything a turn needs, wired up by the `/api/agent/chat` route. */
export interface AgentRun {
  emit(event: AgentEvent): void;
  /** The conversation this turn belongs to; its designs are remembered there. */
  conversationId: string;
  signal: AbortSignal;
  tools: ToolRegistry;
  /** The request's logger, handed to tools. */
  log: ToolLogger;
  /** Where turn traces are stored for this process. */
  traces: TraceRepository;
  /** The chat already shows earlier messages of this conversation. */
  resume?: boolean;
}

/** What the model is told after a tool ran (or didn't). */
export interface ToolOutcome {
  content: string;
  isError: boolean;
  /** The failure was problems the model can fix and resend. */
  retryable: boolean;
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
      retryable: false,
    };
  }

  const result = await run.tools.run(call.name, call.args, {
    signal: run.signal,
    log: run.log,
    showUi: (tree) => {
      const id = randomUUID();
      rememberDesign(run.conversationId, id, tree);
      run.emit({ type: "ui", id, tree });
    },
  });
  run.emit({ type: "tool_result", call, result });
  return {
    content: JSON.stringify({ summary: result.summary, data: result.data }),
    isError: !result.ok,
    retryable: result.retryable === true,
  };
}
