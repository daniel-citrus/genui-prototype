import type { UiNode } from "shared/ui";
import type { HistoryMessage } from "../ports/AgentLlm";
/**
 * Per-conversation message history, in memory only. The client owns the
 * `conversationId`; the server keeps its transcript here for as long as the
 * process lives. Restart = conversations reset. Bounded so a long-running
 * server doesn't grow without limit.
 */

type History = HistoryMessage[];

/**
 * A conversation's transcript plus its newest designs, keyed by `ui` event id.
 * A click names the design it came from; after Stop the chat may show an
 * older design than the newest sent, so several are kept.
 */
interface Conversation {
  history: History;
  /** Oldest first (Map insertion order). */
  designs: Map<string, UiNode>;
}

/**
 * Most conversations kept at once. Past it, the least recently used is
 * forgotten; the agent then says so if the chat carries on (see loop.ts).
 */
export const MAX_CONVERSATIONS = 500;

/** Most designs remembered per conversation; a newer one evicts the oldest. */
export const MAX_DESIGNS_PER_CONVERSATION = 5;

/** Least recently used first: every use moves an entry to the end. */
const store = new Map<string, Conversation>();

/** Returns the conversation's entry, creating it, and marks it most recently used. */
function useConversation(conversationId: string): Conversation {
  const conversation = store.get(conversationId) ?? { history: [], designs: new Map() };
  store.delete(conversationId);
  store.set(conversationId, conversation);
  if (store.size > MAX_CONVERSATIONS) {
    const [leastRecent] = store.keys();
    store.delete(leastRecent);
  }
  return conversation;
}

export function getHistory(conversationId: string): History {
  return useConversation(conversationId).history;
}

/** Keeps a design that was sent as the `ui` event `id`. */
export function rememberDesign(conversationId: string, id: string, tree: UiNode): void {
  const { designs } = useConversation(conversationId);
  designs.set(id, tree);
  if (designs.size > MAX_DESIGNS_PER_CONVERSATION) {
    const [oldest] = designs.keys();
    designs.delete(oldest);
  }
}

/** The design sent as `ui` event `id`, if still remembered. Doesn't count as a use. */
export function getDesign(conversationId: string, id: string): UiNode | undefined {
  return store.get(conversationId)?.designs.get(id);
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

/** Deletes a conversation's history and designs once any turn queued on it has ended. */
export function forgetConversation(conversationId: string): Promise<void> {
  return oneTurnAtATime(conversationId, async () => resetConversation(conversationId));
}
