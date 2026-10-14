import type { ComponentCategory } from "shared/components";
import type { ComponentRepository } from "../../ports/ComponentRepository";
import type { ToolDefinition } from "../tools";

const CATEGORIES: ComponentCategory[] = ["layout", "text", "input", "display"];

/** Lists the catalog without props schemas or examples, optionally by category. */
export function listComponentsTool(components: ComponentRepository): ToolDefinition {
  return {
    name: "list_components",
    description:
      "List the predefined UI components you can use, with what each is for. Call this before choosing components.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: CATEGORIES,
          description: "Only list components in this category.",
        },
      },
      additionalProperties: false,
    },
    async run(args) {
      const category = args.category as ComponentCategory | undefined;
      const all = await components.list();
      const listed = category ? all.filter((c) => c.category === category) : all;
      return {
        ok: true,
        summary: `Listed ${listed.length}${category ? ` ${category}` : ""} components`,
        data: {
          components: listed.map(({ name, category, description, children }) => ({
            name,
            category,
            description,
            children,
          })),
        },
      };
    },
  };
}

/** Reads one component's props schema and example props by exact name. */
export function getComponentTool(components: ComponentRepository): ToolDefinition {
  return {
    name: "get_component",
    description:
      "Get one component's props schema and an example. Call this before using a component, so its props are valid.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The component's name, such as Button." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    async run(args) {
      const name = args.name as string;
      const component = await components.getByName(name);
      if (!component) {
        const available = (await components.list()).map((c) => c.name);
        const lower = name.toLowerCase();
        const didYouMean = available.find((n) => n.toLowerCase() === lower);
        return {
          ok: false,
          summary: `No component named ${name}`,
          data: didYouMean ? { available, didYouMean } : { available },
        };
      }
      const { category, description, children, propsSchema, exampleProps } = component;
      return {
        ok: true,
        summary: `Read ${component.name}`,
        data: { name: component.name, category, description, children, propsSchema, exampleProps },
      };
    },
  };
}
