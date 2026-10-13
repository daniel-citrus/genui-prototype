import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ComponentSpec, PropsSchema } from "shared/components";

export const components = pgTable("components", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  spec: jsonb("spec").$type<ComponentSpec>().notNull(),
  propsSchema: jsonb("props_schema").$type<PropsSchema>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ComponentRow = typeof components.$inferSelect;
export type NewComponentRow = typeof components.$inferInsert;
