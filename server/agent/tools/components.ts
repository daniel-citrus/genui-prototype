import type { Component, ComponentCategory } from "shared/components";
import type { StoredCustomComponent } from "shared/customComponents";
import type { ComponentRepository } from "../../ports/ComponentRepository";
import type { CustomComponentRepository } from "../../ports/CustomComponentRepository";
import type { ToolDefinition } from "../tools";

export const CATEGORIES: ComponentCategory[] = ["layout", "text", "input", "display"];

/** What a tool says when the custom component repository fails. */
export const UNAVAILABLE = "Custom components are unavailable";

/** Custom components listed after the catalog; `more` counts the rest. */
const MAX_LISTED_CUSTOM_COMPONENTS = 40;
/** A listed custom component's description is cut to this many characters. */
const MAX_LISTED_DESCRIPTION_CHARS = 200;

/**
 * Custom components that aren't deleted, by name, matching `search` if given.
 * One whose name matches a catalog name ignoring case is left out: the
 * catalog component wins. At most MAX_CUSTOM_COMPONENTS aren't deleted, so
 * all of them are read.
 */
async function visibleCustomComponents(
  customComponents: CustomComponentRepository,
  catalog: Component[],
  search?: string,
): Promise<StoredCustomComponent[]> {
  const catalogNames = new Set(catalog.map((c) => c.name.toLowerCase()));
  const { components } = await customComponents.list({ search });
  return components.filter((c) => !catalogNames.has(c.name.toLowerCase()));
}

/**
 * Lists the catalog without props schemas or examples, optionally by
 * category. With `customComponents`, also lists up to
 * MAX_LISTED_CUSTOM_COMPONENTS custom components after it, which `search`
 * narrows; if they can't be read, the catalog is still listed.
 */
export function listComponentsTool(
  components: ComponentRepository,
  customComponents?: CustomComponentRepository,
): ToolDefinition {
  return {
    name: "list_components",
    description: customComponents
      ? "List the UI components you can use, with what each is for: the predefined catalog, then custom components (custom: true). Call this before choosing components."
      : "List the predefined UI components you can use, with what each is for. Call this before choosing components.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: CATEGORIES,
          description: "Only list components in this category.",
        },
        ...(customComponents && {
          search: {
            type: "string",
            maxLength: 100,
            description: "Only list custom components whose name or description contains this, ignoring case.",
          },
        }),
      },
      additionalProperties: false,
    },
    async run(args, ctx) {
      const category = args.category as ComponentCategory | undefined;
      const all = await components.list();
      const inCategory = (c: { category: ComponentCategory }) => !category || c.category === category;
      const listed: Record<string, unknown>[] = all
        .filter(inCategory)
        .map(({ name, category, description, children }) => ({ name, category, description, children }));
      const extra: Record<string, unknown> = {};
      if (customComponents) {
        try {
          const search = args.search as string | undefined;
          const custom = (await visibleCustomComponents(customComponents, all, search)).filter(inCategory);
          listed.push(
            ...custom.slice(0, MAX_LISTED_CUSTOM_COMPONENTS).map(({ name, category, description, children, version }) => ({
              name,
              category,
              description: description.slice(0, MAX_LISTED_DESCRIPTION_CHARS),
              children,
              custom: true,
              version,
            })),
          );
          if (custom.length > MAX_LISTED_CUSTOM_COMPONENTS) {
            extra.more = {
              count: custom.length - MAX_LISTED_CUSTOM_COMPONENTS,
              hint: "Pass search to narrow custom components",
            };
          }
        } catch (err) {
          ctx.log.error({ err }, "loading custom components failed");
          extra.note = UNAVAILABLE;
        }
      }
      return {
        ok: true,
        summary: `Listed ${listed.length}${category ? ` ${category}` : ""} components`,
        data: { components: listed, ...extra },
      };
    },
  };
}

/**
 * Reads one component's props schema and example props by exact name,
 * looking in the catalog first. With `customComponents`, also reads a custom
 * component that isn't deleted, with its version and template.
 */
export function getComponentTool(
  components: ComponentRepository,
  customComponents?: CustomComponentRepository,
): ToolDefinition {
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
    async run(args, ctx) {
      const name = args.name as string;
      const component = await components.getByName(name);
      if (component) {
        const { category, description, children, propsSchema, exampleProps } = component;
        return {
          ok: true,
          summary: `Read ${component.name}`,
          data: { name: component.name, category, description, children, propsSchema, exampleProps },
        };
      }
      const catalog = await components.list();
      let custom: StoredCustomComponent[] = [];
      if (customComponents) {
        try {
          custom = await visibleCustomComponents(customComponents, catalog);
        } catch (err) {
          ctx.log.error({ err }, "loading custom components failed");
          return { ok: false, summary: UNAVAILABLE };
        }
        const found = custom.find((c) => c.name === name);
        if (found) {
          const { category, description, children, propsSchema, exampleProps, version, template } = found;
          return {
            ok: true,
            summary: `Read ${name} v${version}`,
            data: { name, category, description, children, propsSchema, exampleProps, custom: true, version, template },
          };
        }
      }
      const available = [...catalog, ...custom].map((c) => c.name);
      const lower = name.toLowerCase();
      const didYouMean = available.find((n) => n.toLowerCase() === lower);
      return {
        ok: false,
        summary: `No component named ${name}`,
        data: didYouMean ? { available, didYouMean } : { available },
      };
    },
  };
}
