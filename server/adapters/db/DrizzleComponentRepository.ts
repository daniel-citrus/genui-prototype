import { asc, eq } from "drizzle-orm";
import type { Component, ComponentPatch, NewComponent } from "shared/components";
import { NameTakenError, type ComponentRepository } from "../../ports/ComponentRepository";
import type { Db } from "./client";
import { components, type ComponentRow } from "./schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toComponent(row: ComponentRow): Component {
  return {
    id: row.id,
    name: row.name,
    spec: row.spec,
    propsSchema: row.propsSchema,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export class DrizzleComponentRepository implements ComponentRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async list(): Promise<Component[]> {
    const rows = await this.db.select().from(components).orderBy(asc(components.name));
    return rows.map(toComponent);
  }

  async get(id: string): Promise<Component | undefined> {
    if (!UUID_RE.test(id)) return undefined;
    const [row] = await this.db.select().from(components).where(eq(components.id, id));
    return row && toComponent(row);
  }

  async create(input: NewComponent): Promise<Component> {
    try {
      const [row] = await this.db
        .insert(components)
        .values({ name: input.name, spec: input.spec, propsSchema: input.propsSchema })
        .returning();
      return toComponent(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new NameTakenError(input.name);
      throw err;
    }
  }

  async update(id: string, patch: ComponentPatch): Promise<Component | undefined> {
    if (!UUID_RE.test(id)) return undefined;
    const values: Partial<typeof components.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.spec !== undefined) values.spec = patch.spec;
    if (patch.propsSchema !== undefined) values.propsSchema = patch.propsSchema;
    try {
      const [row] = await this.db
        .update(components)
        .set(values)
        .where(eq(components.id, id))
        .returning();
      return row && toComponent(row);
    } catch (err) {
      if (isUniqueViolation(err) && patch.name !== undefined) {
        throw new NameTakenError(patch.name);
      }
      throw err;
    }
  }

  async remove(id: string): Promise<boolean> {
    if (!UUID_RE.test(id)) return false;
    const rows = await this.db
      .delete(components)
      .where(eq(components.id, id))
      .returning({ id: components.id });
    return rows.length > 0;
  }
}
