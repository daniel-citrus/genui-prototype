import type { AgentEvent, ToolCall, ToolResult } from "shared/api";
import type { UiNode } from "shared/ui";
import type { AgentLlm, HistoryMessage } from "../ports/AgentLlm";
import { getHistory, hasConversation, oneTurnAtATime } from "./conversations";
import {
  callKey,
  MAX_STEPS,
  MAX_TOOL_CALLS_PER_TURN,
  MAX_TURN_TOKENS,
} from "./guardrails";
import { jsonObjectArguments, parseToolArguments } from "./openaiTools";
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

export const UNFINISHED_NOTICE = "This isn't finished: the last design still had problems.";

export const REPAIR_REMINDER = (tool: string) =>
  `Your last ${tool} call reported problems, so nothing was shown or saved. Fix them and call ${tool} again now. If you need to ask the person something first, reply with only that question.`;

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
 *
 * While the latest build (`render_ui`, or `define_component` with no render
 * since) has fixable problems, a completion's text is held. A text-only reply
 * then gets one system reminder in place of ending the turn; if the turn is
 * still unfinished after that, it ends as `unresolved` with a notice.
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
  // Keys of calls made since the last successful write, and of every successful
  // write: an identical call is not run twice, but a read may repeat after a write.
  const seen = new Set<string>();
  const written = new Set<string>();
  let endedBy: EndedBy = "stopped";
  let repairReminders = 0;
  // Whether the latest build call failed in a way the model can fix, and which
  // tool failed last (named in the reminder).
  let renderFailed = false;
  let defineFailed = false;
  let failedTool = "render_ui";

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

      // Why tools are off for completion `at`, if they are.
      const toolsOffAt = (at: number): EndedBy | undefined =>
        toolCalls >= MAX_TOOL_CALLS_PER_TURN
          ? "tool_budget"
          : promptTokens + completionTokens >= MAX_TURN_TOKENS
            ? "token_budget"
            : at >= MAX_STEPS - 1
              ? "max_steps"
              : undefined;
      const toolsOff = toolsOffAt(step);

      const allowTools = toolsOff === undefined;
      const unfinished = renderFailed || defineFailed;
      const held: string[] = [];

      // Ask the model. Text deltas go out as SSE `text` events.
      steps += 1;
      const turn = await llm.complete({
        messages: history,
        tools: run.tools.specs,
        allowTools,
        signal: run.signal,
        onText: (text) => (unfinished ? held.push(text) : run.emit({ type: "text", text })),
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

      const emitHeld = () => {
        if (held.length > 0) run.emit({ type: "text", text: held.join("") });
      };

      // No tools → this is the reply, unless a failed build is left to fix.
      if (turn.toolCalls.length === 0) {
        if (!unfinished) {
          endedBy = "reply";
          return;
        }
        if (run.signal.aborted) {
          emitHeld();
          return;
        }
        // One reminder, if the model can use tools on its next completion.
        if (repairReminders === 0 && toolsOffAt(step + 1) === undefined) {
          repairReminders = 1;
          history.push({ role: "system", content: REPAIR_REMINDER(failedTool) });
          continue;
        }
        emitHeld();
        run.emit({ type: "notice", message: UNFINISHED_NOTICE });
        endedBy = "unresolved";
        return;
      }
      emitHeld();

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
        if (turn.truncated && jsonObjectArguments(tc.arguments) === undefined) {
          content = skipCall(
            run,
            call,
            "Call was cut off",
            "This call was cut off before its arguments finished. Call it again with a smaller tree.",
          );
        } else if (toolsOff !== undefined || toolCalls > MAX_TOOL_CALLS_PER_TURN) {
          content = skipCall(
            run,
            call,
            "Tool budget used up",
            "Tool budget for this turn is used up; answer with what you have.",
          );
        } else if (written.has(key) || seen.has(key)) {
          content = skipCall(
            run,
            call,
            "Already called with these arguments",
            `You already called \`${call.name}\` with these arguments in this turn; use that result.`,
          );
        } else {
          seen.add(key);
          const outcome = await handleToolCall(run, call);
          content = outcome.content;
          if (call.name === "render_ui") {
            renderFailed = outcome.retryable;
            if (outcome.retryable) failedTool = call.name;
            else if (!outcome.isError) defineFailed = false;
          } else if (call.name === "define_component") {
            defineFailed = outcome.retryable;
            if (outcome.retryable) failedTool = call.name;
          }
          if (!outcome.isError && run.tools.writes(call.name)) {
            seen.clear();
            written.add(key);
          }
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
    trace.repairReminders = repairReminders;
    trace.steps = steps;
    trace.toolCalls = toolCalls;
    trace.promptTokens = promptTokens;
    trace.completionTokens = completionTokens;
    try {
      await run.traces.save(trace);
    } catch (err) {
      run.log.warn({ conversationId, err }, "failed to save agent trace");
    }
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
