import { randomUUID } from "node:crypto";
import type { CatalogComponent, Component } from "shared/components";
import type { ComponentRepository } from "../ComponentRepository";

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A `ComponentRepository` over an in-memory catalog, for tests. */
export class InMemoryComponentRepository implements ComponentRepository {
  private readonly components: Component[];

  constructor(entries: CatalogComponent[]) {
    const now = new Date().toISOString();
    this.components = entries
      .map((entry) => ({ ...structuredClone(entry), id: randomUUID(), createdAt: now, updatedAt: now }))
      .sort((a, b) => compare(a.category, b.category) || compare(a.name, b.name));
  }

  async list(): Promise<Component[]> {
    return this.components.map((c) => structuredClone(c));
  }

  async get(id: string): Promise<Component | undefined> {
    const found = this.components.find((c) => c.id === id);
    return found && structuredClone(found);
  }

  async getByName(name: string): Promise<Component | undefined> {
    const found = this.components.find((c) => c.name === name);
    return found && structuredClone(found);
  }
}
