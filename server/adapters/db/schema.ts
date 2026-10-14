import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ComponentCategory, ComponentChildren, PropsSchema } from "shared/components";

export const components = pgTable(
  "components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    description: text("description").notNull(),
    category: text("category").$type<ComponentCategory>().notNull(),
    children: text("children").$type<ComponentChildren>().notNull(),
    propsSchema: jsonb("props_schema").$type<PropsSchema>().notNull(),
    exampleProps: jsonb("example_props").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "components_category_check",
      sql`${table.category} in ('layout', 'text', 'input', 'display')`,
    ),
    check("components_children_check", sql`${table.children} in ('none', 'any')`),
  ],
);

export type ComponentRow = typeof components.$inferSelect;
export type NewComponentRow = typeof components.$inferInsert;
