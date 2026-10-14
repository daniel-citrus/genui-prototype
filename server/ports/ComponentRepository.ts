import type { Component } from "shared/components";

/** Read-only access to the component catalog. Only the seed writes it. */
export interface ComponentRepository {
  /** All components, ordered by category, then name. */
  list(): Promise<Component[]>;
  /** Resolves `undefined` when there is no such component. */
  get(id: string): Promise<Component | undefined>;
  /** Exact match on `name`. Resolves `undefined` when there is no such component. */
  getByName(name: string): Promise<Component | undefined>;
}
