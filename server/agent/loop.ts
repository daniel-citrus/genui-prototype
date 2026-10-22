import type { AgentEvent, ToolCall, ToolResult } from "shared/api";
import type { UiNode } from "shared/ui";
import type { AgentLlm, HistoryMessage } from "../ports/AgentLlm";
import { getHistory, hasConversation, oneTurnAtATime, rememberTrace } from "./conversations";
import {
  callKey,
  MAX_STEPS,
  MAX_TOOL_CALLS_PER_TURN,
  MAX_TURN_TOKENS,
} from "./guardrails";
import { parseToolArguments } from "./openaiTools";
import { handleToolCall, type AgentRun } from "./run";
import type {
  AgentTrace,
  AgentTraceCompletion,
  AgentTraceToolCall,
  EndedBy,
  ToolSkipReason,
} from "./trace";

export { MAX_STEPS };

export const TRUNCATED_NOTICE = "The reply was cut off because it was too long.";

export const FORGOTTEN_NOTICE =
  "I no longer have the earlier messages in this chat (the server restarted or the chat was set aside), so I'm answering this one on its own.";

/**
 * The tool-use loop, server-side. Streams events through `run`. Turns on one
 * conversation run one at a time, since they share its history.
 */
export function runAgent(
  userText: string,
  conversationId: string,
  run: AgentRun,
  llm: AgentLlm,
): Promise<void> {
  return oneTurnAtATime(conversationId, () => {
    // The chat still shows earlier messages the server no longer has (restart,
    // or forgotten to make room): say so rather than answer as if it remembers.
    if (run.resume && !hasConversation(conversationId)) {
      run.emit({ type: "notice", message: FORGOTTEN_NOTICE });
    }
    return runTurn(userText, conversationId, getHistory(conversationId), run, llm);
  });
}

/**
 * One chat turn. Each iteration sends the conversation history and the tool
 * specs. The model replies with text and/or tool calls; we run those tools
 * locally, append the results to history, and call it again so it can write
 * the reply or ask for another tool. Stop when it returns no tools.
 *
 * The turn is capped (see `guardrails.ts`): the last completion, and any
 * completion after the tool-call or token budget is spent, is sent with tools
 * off so the model answers with what it has. Tool calls past the budget, and
 * repeats of an earlier call, are answered without running.
 */
async function runTurn(
  userText: string,
  conversationId: string,
  history: HistoryMessage[],
  run: AgentRun,
  llm: AgentLlm,
): Promise<void> {
  history.push({ role: "user", content: userText });

  let steps = 0;
  let toolCalls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  const seen = new Set<string>();
  let endedBy: EndedBy = "stopped";

  const trace: AgentTrace = {
    conversationId,
    userText,
    endedBy,
    steps: 0,
    toolCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    completions: [],
  };

  let currentCompletion: AgentTraceCompletion | null = null;
  let recordingTool: ToolCall | null = null;
  let uiForCurrentTool: { id: string; tree: UiNode } | undefined;
  let lastToolResult: ToolResult | null = null;

  const baseEmit = run.emit.bind(run);
  run.emit = (event: AgentEvent) => {
    if (event.type === "error") trace.error = event.message;
    if (event.type === "ui" && recordingTool) {
      uiForCurrentTool = { id: event.id, tree: event.tree };
    }
    if (
      event.type === "tool_result" &&
      recordingTool &&
      event.call.id === recordingTool.id
    ) {
      lastToolResult = event.result;
    }
    baseEmit(event);
  };

  const finishToolRecord = (call: ToolCall) => {
    if (!currentCompletion || !lastToolResult) return;
    const entry: AgentTraceToolCall = { call, result: lastToolResult };
    const skipped = skipReason(lastToolResult.summary);
    if (skipped) entry.skipped = skipped;
    if (uiForCurrentTool) entry.ui = uiForCurrentTool;
    currentCompletion.toolCalls.push(entry);
    recordingTool = null;
    lastToolResult = null;
    uiForCurrentTool = undefined;
  };

  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (run.signal.aborted) return;

      // Why tools are off for this completion, if they are.
      const toolsOff: EndedBy | undefined =
        toolCalls >= MAX_TOOL_CALLS_PER_TURN
          ? "tool_budget"
          : promptTokens + completionTokens >= MAX_TURN_TOKENS
            ? "token_budget"
            : step === MAX_STEPS - 1
              ? "max_steps"
              : undefined;

      const allowTools = toolsOff === undefined;

      // Ask the model. Text deltas go out as SSE `text` events.
      steps += 1;
      const turn = await llm.complete({
        messages: history,
        tools: run.tools.specs,
        allowTools,
        signal: run.signal,
        onText: (text) => run.emit({ type: "text", text }),
      });
      promptTokens += turn.usage?.promptTokens ?? 0;
      completionTokens += turn.usage?.completionTokens ?? 0;
      if (turn.truncated) run.emit({ type: "notice", message: TRUNCATED_NOTICE });

      currentCompletion = {
        allowTools,
        content: turn.content,
        truncated: turn.truncated === true,
        toolCalls: [],
      };
      if (turn.usage) currentCompletion.usage = turn.usage;
      trace.completions.push(currentCompletion);

      // Remember this assistant turn so the next iteration includes it.
      const assistant: Extract<HistoryMessage, { role: "assistant" }> = {
        role: "assistant",
        content: turn.content,
      };
      if (turn.toolCalls.length > 0) {
        assistant.tool_calls = turn.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      history.push(assistant);

      // No tools → this is the reply. Turn is done.
      if (turn.toolCalls.length === 0) {
        endedBy = "reply";
        return;
      }

      // Answer each requested tool and push its result as a `tool` message;
      // the model sees it on the next completion. Every call gets exactly one
      // message, run or not, or the next completion would be rejected.
      for (const tc of turn.toolCalls) {
        const call: ToolCall = {
          id: tc.id,
          name: tc.name,
          args: parseToolArguments(tc.arguments),
        };
        const key = callKey(call.name, call.args);
        toolCalls += 1;

        recordingTool = call;
        lastToolResult = null;
        uiForCurrentTool = undefined;

        let content: string;
        if (toolsOff !== undefined || toolCalls > MAX_TOOL_CALLS_PER_TURN) {
          content = skipCall(
            run,
            call,
            "Tool budget used up",
            "Tool budget for this turn is used up; answer with what you have.",
          );
        } else if (seen.has(key)) {
          content = skipCall(
            run,
            call,
            "Already called with these arguments",
            `You already called \`${call.name}\` with these arguments in this turn; use that result.`,
          );
        } else {
          seen.add(key);
          content = (await handleToolCall(run, call)).content;
        }
        finishToolRecord(call);
        history.push({ role: "tool", tool_call_id: tc.id, content });
      }

      // Asked for tools despite having them off: give up on this turn.
      if (toolsOff !== undefined) {
        endedBy = toolsOff;
        break;
      }
    }

    run.emit({
      type: "error",
      message: "Stopped after too many steps. Try a smaller request.",
    });
  } finally {
    trace.endedBy = endedBy;
    trace.steps = steps;
    trace.toolCalls = toolCalls;
    trace.promptTokens = promptTokens;
    trace.completionTokens = completionTokens;
    rememberTrace(conversationId, trace);
    run.emit = baseEmit;
    run.log.info(
      { conversationId, steps, toolCalls, promptTokens, completionTokens, endedBy },
      "agent turn finished",
    );
  }
}

function skipReason(summary: string): ToolSkipReason | undefined {
  if (summary === "Stopped before this ran.") return "stopped";
  if (summary === "Already called with these arguments") return "duplicate";
  if (summary === "Tool budget used up") return "budget";
  return undefined;
}

/** Reports a call that was not run, and returns what the model is told. */
function skipCall(
  run: AgentRun,
  call: ToolCall,
  summary: string,
  content: string,
): string {
  run.emit({ type: "tool_call", call });
  run.emit({ type: "tool_result", call, result: { ok: false, summary } });
  return content;
}
