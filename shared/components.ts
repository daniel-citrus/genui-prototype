/** The predefined UI components the agent can use, as stored in the catalog. */

export type ComponentCategory = "layout" | "text" | "input" | "display";
export type ComponentChildren = "none" | "any";

/** JSON Schema for the props a component accepts. */
export interface PropsSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
}

/** One catalog entry, as written in the catalog file. */
export interface CatalogComponent {
  name: string;
  description: string;
  category: ComponentCategory;
  children: ComponentChildren;
  propsSchema: PropsSchema;
  exampleProps: Record<string, unknown>;
}

/** A catalog entry as stored. */
export interface Component extends CatalogComponent {
  id: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}
