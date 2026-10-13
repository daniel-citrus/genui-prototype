/** A generated UI component as stored by the API and shown in the sandbox. */

/** The component's renderable description; its shape is owned by the renderer. */
export type ComponentSpec = Record<string, unknown>;

/** JSON Schema for the props a component accepts. */
export interface PropsSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface Component {
  id: string;
  name: string;
  spec: ComponentSpec;
  propsSchema: PropsSchema;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
}

export type NewComponent = {
  name: string;
  spec: ComponentSpec;
  propsSchema: PropsSchema;
};

export type ComponentPatch = Partial<NewComponent>;
