import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { AgentTrace } from "../../agent/trace";

export const agentTraces = pgTable(
  "agent_traces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: text("conversation_id").notNull(),
    payload: jsonb("payload").$type<AgentTrace>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agent_traces_conversation_id_created_at_idx").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);
