import type { Component, ComponentPatch, NewComponent } from "shared/components";

/** Where components are stored. */
export interface ComponentRepository {
  list(): Promise<Component[]>;
  get(id: string): Promise<Component | undefined>;
  /** Throws `NameTakenError` when another component already has the name. */
  create(input: NewComponent): Promise<Component>;
  /**
   * Resolves `undefined` when there is no such component. Throws
   * `NameTakenError` when the new name belongs to another component.
   */
  update(id: string, patch: ComponentPatch): Promise<Component | undefined>;
  /** Resolves whether a component was removed. */
  remove(id: string): Promise<boolean>;
}

/**
 * A component name must be unique. The conflicting name is `componentName`
 * (`name` stays "NameTakenError", as on any other Error subclass).
 */
export class NameTakenError extends Error {
  readonly componentName: string;

  constructor(componentName: string) {
    super(`A component named "${componentName}" already exists`);
    this.name = "NameTakenError";
    this.componentName = componentName;
  }
}
