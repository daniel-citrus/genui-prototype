import type { AgentTrace } from "../agent/trace";

export const MAX_TRACES_PER_CONVERSATION = 5;

export interface TraceRepository {
  save(trace: AgentTrace): Promise<void>;
  listByConversation(conversationId: string): Promise<AgentTrace[]>;
}
