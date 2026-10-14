import type { ToolCall } from "shared/api";
import type { AgentLlm, HistoryMessage } from "../ports/AgentLlm";
import { getHistory, hasConversation, oneTurnAtATime } from "./conversations";
import {
  callKey,
  MAX_STEPS,
  MAX_TOOL_CALLS_PER_TURN,
  MAX_TURN_TOKENS,
} from "./guardrails";
import { parseToolArguments } from "./openaiTools";
import { handleToolCall, type AgentRun } from "./run";

export { MAX_STEPS };

/** Why a turn ended, for the per-turn usage log. */
type EndedBy = "reply" | "max_steps" | "tool_budget" | "token_budget" | "stopped";

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

      // Ask the model. Text deltas go out as SSE `text` events.
      steps += 1;
      const turn = await llm.complete({
        messages: history,
        tools: run.tools.specs,
        allowTools: toolsOff === undefined,
        signal: run.signal,
        onText: (text) => run.emit({ type: "text", text }),
      });
      promptTokens += turn.usage?.promptTokens ?? 0;
      completionTokens += turn.usage?.completionTokens ?? 0;
      if (turn.truncated) run.emit({ type: "notice", message: TRUNCATED_NOTICE });

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
    run.log.info(
      { conversationId, steps, toolCalls, promptTokens, completionTokens, endedBy },
      "agent turn finished",
    );
  }
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
