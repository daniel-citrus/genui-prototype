import { asc, eq, inArray } from "drizzle-orm";
import type { AgentTrace } from "../../agent/trace";
import {
  MAX_TRACES_PER_CONVERSATION,
  type TraceRepository,
} from "../../ports/TraceRepository";
import type { TracesDb } from "./client";
import { agentTraces } from "./schema";

export class DrizzleTraceRepository implements TraceRepository {
  private readonly db: TracesDb;

  constructor(db: TracesDb) {
    this.db = db;
  }

  async save(trace: AgentTrace): Promise<void> {
    await this.db.insert(agentTraces).values({
      conversationId: trace.conversationId,
      payload: trace,
    });
    const rows = await this.db
      .select({ id: agentTraces.id })
      .from(agentTraces)
      .where(eq(agentTraces.conversationId, trace.conversationId))
      .orderBy(asc(agentTraces.createdAt), asc(agentTraces.id));
    const excess = rows.length - MAX_TRACES_PER_CONVERSATION;
    if (excess > 0) {
      await this.db.delete(agentTraces).where(
        inArray(
          agentTraces.id,
          rows.slice(0, excess).map((row) => row.id),
        ),
      );
    }
  }

  async listByConversation(conversationId: string): Promise<AgentTrace[]> {
    const rows = await this.db
      .select({ payload: agentTraces.payload })
      .from(agentTraces)
      .where(eq(agentTraces.conversationId, conversationId))
      .orderBy(asc(agentTraces.createdAt), asc(agentTraces.id))
      .limit(MAX_TRACES_PER_CONVERSATION);
    return rows.map((row) => row.payload);
  }
}
