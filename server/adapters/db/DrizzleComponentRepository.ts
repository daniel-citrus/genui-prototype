import { asc, eq } from "drizzle-orm";
import type { Component } from "shared/components";
import type { ComponentRepository } from "../../ports/ComponentRepository";
import type { Db } from "./client";
import { components, type ComponentRow } from "./schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toComponent(row: ComponentRow): Component {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    children: row.children,
    propsSchema: row.propsSchema,
    exampleProps: row.exampleProps,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class DrizzleComponentRepository implements ComponentRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async list(): Promise<Component[]> {
    const rows = await this.db
      .select()
      .from(components)
      .orderBy(asc(components.category), asc(components.name));
    return rows.map(toComponent);
  }

  async get(id: string): Promise<Component | undefined> {
    if (!UUID_RE.test(id)) return undefined;
    const [row] = await this.db.select().from(components).where(eq(components.id, id));
    return row && toComponent(row);
  }

  async getByName(name: string): Promise<Component | undefined> {
    const [row] = await this.db.select().from(components).where(eq(components.name, name));
    return row && toComponent(row);
  }
}
