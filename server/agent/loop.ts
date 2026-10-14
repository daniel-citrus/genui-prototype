import type { ToolCall } from "shared/api";
import type { AgentLlm, HistoryMessage } from "../ports/AgentLlm";
import { getHistory, hasConversation, oneTurnAtATime } from "./conversations";
import { parseToolArguments } from "./openaiTools";
import { handleToolCall, type AgentRun } from "./run";

export const FORGOTTEN_NOTICE =
  "I no longer have the earlier messages in this chat (the server restarted or the chat was set aside), so I'm answering this one on its own.";

/** LLM completions allowed per turn. */
export const MAX_STEPS = 10;

/**
 * Instructions for the model. The loop does not send these: the LLM adapter
 * prepends them (its `systemPrompt` option), so they are never stored in
 * history.
 */
export const SYSTEM_PROMPT = `You are an assistant that helps people design and describe UI components.

Guidelines:
- Keep replies brief: a sentence or two, then the result.
- Use the provided tools when they fit the request.
- Use only the predefined components. Call list_components to see them, and get_component before relying on a component's props.
- If no component fits the request, say so instead of inventing one.
- If you cannot do something, say so plainly instead of guessing.`;

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
    return runTurn(userText, getHistory(conversationId), run, llm);
  });
}

/**
 * One chat turn. Each iteration sends the conversation history and the tool
 * specs. The model replies with text and/or tool calls; we run those tools
 * locally, append the results to history, and call it again so it can write
 * the reply or ask for another tool. Stop when it returns no tools, or after
 * `MAX_STEPS` completions.
 */
async function runTurn(
  userText: string,
  history: HistoryMessage[],
  run: AgentRun,
  llm: AgentLlm,
): Promise<void> {
  history.push({ role: "user", content: userText });

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (run.signal.aborted) return;

    // Ask the model. Text deltas go out as SSE `text` events.
    const turn = await llm.complete({
      messages: history,
      tools: run.tools.specs,
      signal: run.signal,
      onText: (text) => run.emit({ type: "text", text }),
    });

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
    if (turn.toolCalls.length === 0) return;

    // Run each requested tool and push its result as a `tool` message; the
    // model sees it on the next completion.
    for (const tc of turn.toolCalls) {
      const call: ToolCall = {
        id: tc.id,
        name: tc.name,
        args: parseToolArguments(tc.arguments),
      };
      const outcome = await handleToolCall(run, call);
      history.push({
        role: "tool",
        tool_call_id: tc.id,
        content: outcome.content,
      });
    }
  }

  run.emit({
    type: "error",
    message: "Stopped after too many steps. Try a smaller request.",
  });
}
