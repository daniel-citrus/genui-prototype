import type { AgentTrace } from "../../agent/trace";
import { MAX_TRACES_PER_CONVERSATION, type TraceRepository } from "../TraceRepository";

/** A `TraceRepository` in memory, for tests. Same cap and order as durable storage will use. */
export class InMemoryTraceRepository implements TraceRepository {
  private readonly byConversation = new Map<string, AgentTrace[]>();

  async save(trace: AgentTrace): Promise<void> {
    const traces = this.byConversation.get(trace.conversationId) ?? [];
    traces.push(trace);
    if (traces.length > MAX_TRACES_PER_CONVERSATION) traces.shift();
    this.byConversation.set(trace.conversationId, traces);
  }

  async listByConversation(conversationId: string): Promise<AgentTrace[]> {
    return this.byConversation.get(conversationId) ?? [];
  }
}
