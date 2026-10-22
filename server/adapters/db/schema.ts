import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ComponentCategory, ComponentChildren, PropsSchema } from "shared/components";
import type { TemplateNode } from "shared/customComponents";

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

/** One row per custom component name; its definitions are in `custom_component_versions`. */
export const customComponents = pgTable(
  "custom_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    currentVersion: integer("current_version").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("custom_components_name_lower_unique").on(sql`lower(${table.name})`)],
);

/** Every saved definition; rows are only ever added. */
export const customComponentVersions = pgTable(
  "custom_component_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    componentId: uuid("component_id")
      .notNull()
      .references(() => customComponents.id),
    version: integer("version").notNull(),
    description: text("description").notNull(),
    category: text("category").$type<ComponentCategory>().notNull(),
    children: text("children").$type<ComponentChildren>().notNull(),
    propsSchema: jsonb("props_schema").$type<PropsSchema>().notNull(),
    exampleProps: jsonb("example_props").$type<Record<string, unknown>>().notNull(),
    template: jsonb("template").$type<TemplateNode>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("custom_component_versions_component_version_unique").on(
      table.componentId,
      table.version,
    ),
    check(
      "custom_component_versions_category_check",
      sql`${table.category} in ('layout', 'text', 'input', 'display')`,
    ),
    check("custom_component_versions_children_check", sql`${table.children} in ('none', 'any')`),
  ],
);

export type CustomComponentRow = typeof customComponents.$inferSelect;
export type CustomComponentVersionRow = typeof customComponentVersions.$inferSelect;
