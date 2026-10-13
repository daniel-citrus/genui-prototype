import type { HistoryMessage } from "../ports/AgentLlm";

/**
 * Per-conversation message history, in memory only. The client owns the
 * `conversationId`; the server keeps its transcript here for as long as the
 * process lives. Restart = conversations reset. Bounded so a long-running
 * server doesn't grow without limit.
 */

type History = HistoryMessage[];

/**
 * Most conversations kept at once. Past it, the least recently used is
 * forgotten; the agent then says so if the chat carries on (see loop.ts).
 */
export const MAX_CONVERSATIONS = 500;

/** Least recently used first: every use moves an entry to the end. */
const store = new Map<string, History>();

export function getHistory(conversationId: string): History {
  const history = store.get(conversationId) ?? [];
  store.delete(conversationId);
  store.set(conversationId, history);
  if (store.size > MAX_CONVERSATIONS) {
    const [leastRecent] = store.keys();
    store.delete(leastRecent);
  }
  return history;
}

/** Whether the server still has this conversation (it may have been forgotten). */
export function hasConversation(conversationId: string): boolean {
  return store.has(conversationId);
}

export function resetConversation(conversationId: string): void {
  store.delete(conversationId);
}

/** The newest turn queued on each conversation, settled or not. */
const turns = new Map<string, Promise<void>>();

/**
 * Runs a conversation's turns one after another. Stop keeps the history, and
 * a stopped turn may still be finishing a tool call when the next message
 * arrives; without this both would append to the same history, and the model
 * rejects an assistant tool call that isn't followed by its result.
 */
export async function oneTurnAtATime(
  conversationId: string,
  turn: () => Promise<void>,
): Promise<void> {
  const previous = turns.get(conversationId) ?? Promise.resolve();
  const current = previous.then(turn);
  const settled = current.catch(() => {});
  turns.set(conversationId, settled);
  try {
    await current;
  } finally {
    if (turns.get(conversationId) === settled) turns.delete(conversationId);
  }
}
