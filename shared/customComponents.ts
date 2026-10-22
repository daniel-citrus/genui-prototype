/** UI components the agent defines from catalog components and reuses in later conversations. */

import type { ComponentCategory, ComponentChildren, PropsSchema } from "./components";

/** A literal prop value, or `{ $prop: "title" }` to take the instance's `title` prop. */
export type TemplateValue = unknown | { $prop: string };

/** One node of a custom component's template. */
export interface TemplateNode {
  /** Catalog or custom component name. */
  component: string;
  props?: Record<string, TemplateValue>;
  /** `{ $children: true }` marks where the instance's own children go. */
  children?: (TemplateNode | { $children: true })[];
}

/** What the agent writes to define a custom component. */
export interface CustomComponentDefinition {
  name: string;
  description: string;
  category: ComponentCategory;
  children: ComponentChildren;
  propsSchema: PropsSchema;
  exampleProps: Record<string, unknown>;
  template: TemplateNode;
}

/** One version of a custom component as stored. */
export interface StoredCustomComponent extends CustomComponentDefinition {
  /** The current version, or the one asked for by number. */
  version: number;
  /** How many versions exist. */
  versions: number;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  deletedAt: string | null; // ISO timestamp
}

export const CUSTOM_COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*$/;
export const MAX_CUSTOM_COMPONENTS = 200; // not deleted
export const MAX_CUSTOM_COMPONENTS_TOTAL = 500; // deleted included
export const MAX_CUSTOM_COMPONENT_VERSIONS = 20;
export const MAX_DEFINITION_CHARS = 8000;
export const MAX_DESCRIPTION_CHARS = 300;
export const MAX_TEMPLATE_NODES = 40;
export const MAX_TEMPLATE_DEPTH = 6;
export const MAX_CUSTOM_NESTING = 3;
export const MAX_EXPANDED_NODES = 400;
export const MAX_EXPANDED_DEPTH = 24;
