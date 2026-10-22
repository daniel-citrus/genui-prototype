import type { ActionSpec } from "../../actions/types";
import { validateDefinition } from "../../customComponents/definition";
import type { ComponentRepository } from "../../ports/ComponentRepository";
import { CustomComponentError, type CustomComponentRepository } from "../../ports/CustomComponentRepository";
import type { ToolDefinition } from "../tools";
import { CATEGORIES, UNAVAILABLE } from "./components";

/**
 * A repository failure, for logs. Drizzle's own error repeats the query's
 * parameters, which for a save are the whole definition, so only its cause
 * is logged.
 */
const loggable = (err: unknown) => (err instanceof Error && err.cause !== undefined ? err.cause : err);

/**
 * Checks a definition with `validateDefinition` against the catalog, the
 * stored custom components and the registered actions, and saves it as the
 * next version. Logs names, versions and outcomes, never the definition.
 */
export function defineComponentTool(
  components: ComponentRepository,
  customComponents: CustomComponentRepository,
  actions: ActionSpec[],
): ToolDefinition {
  return {
    name: "define_component",
    description:
      "Save a custom component built from existing components, so designs can use it by name in this and later chats. Saving a name that exists adds its next version. Template buttons may only use actions list_actions returned. If it reports problems, nothing is saved: fix them and call it again.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "PascalCase name, such as MenuItemCard. Not a catalog name; unique ignoring case.",
        },
        description: {
          type: "string",
          description: "One plain-text sentence on what it shows and when to use it (at most 300 characters).",
        },
        category: { type: "string", enum: CATEGORIES },
        children: {
          type: "string",
          enum: ["none", "any"],
          description: 'Whether a use may have children. "any" needs a {"$children": true} slot in the template.',
        },
        props_schema: {
          type: "object",
          description:
            'JSON Schema for its props, like a catalog component\'s propsSchema: {"type": "object", "properties": {...}, "required": [...], "additionalProperties": false}, with a description on every property.',
        },
        example_props: {
          type: "object",
          description: "Props valid against props_schema; the template is checked with them.",
        },
        template: {
          type: "object",
          description:
            'The tree one use draws: {"component", "props", "children"} of catalog and custom components, where Markup may draw what nothing else can. A prop value {"$prop": "<name>"} takes that prop from the use; {"$children": true} in a children array marks where the use\'s children go.',
        },
      },
      required: ["name", "description", "category", "children", "props_schema", "example_props", "template"],
      additionalProperties: false,
    },
    async run(args, ctx) {
      const name = args.name as string;
      const definition = {
        name,
        description: args.description,
        category: args.category,
        children: args.children,
        propsSchema: args.props_schema,
        exampleProps: args.example_props,
        template: args.template,
      };
      const catalog = await components.list();
      try {
        const check = await validateDefinition(definition, {
          catalog,
          resolve: (n) => customComponents.getByName(n),
          actions,
        });
        if (!check.ok) {
          const n = check.errors.length;
          ctx.log.info({ name, problems: n }, "custom component definition refused");
          return {
            ok: false,
            summary: `Definition has ${n} problem${n === 1 ? "" : "s"}`,
            data: { errors: check.errors },
          };
        }
        const { version } = await customComponents.save(check.definition);
        ctx.log.info({ name, version }, "custom component saved");
        return { ok: true, summary: `Saved ${name} v${version}`, data: { name, version } };
      } catch (err) {
        if (err instanceof CustomComponentError) {
          ctx.log.info({ name, code: err.code }, "custom component save refused");
          return { ok: false, summary: err.message };
        }
        ctx.log.error({ name, err: loggable(err) }, "saving custom component failed");
        return { ok: false, summary: UNAVAILABLE };
      }
    },
  };
}

/** Hides a custom component; the Components panel can restore it. */
export function deleteComponentTool(
  components: ComponentRepository,
  customComponents: CustomComponentRepository,
): ToolDefinition {
  return {
    name: "delete_component",
    description:
      "Delete a custom component, so it is no longer listed or usable in new designs. Only when the person asks to delete it.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The custom component's exact name." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    async run(args, ctx) {
      const name = args.name as string;
      const lower = name.toLowerCase();
      const catalogName = (await components.list()).find((c) => c.name.toLowerCase() === lower)?.name;
      if (catalogName) {
        return { ok: false, summary: `${catalogName} is a catalog component; only custom components can be deleted` };
      }
      try {
        const found = await customComponents.getByName(name);
        if (!found || found.deletedAt !== null) return { ok: false, summary: `No custom component named ${name}` };
        await customComponents.softDelete(name);
      } catch (err) {
        ctx.log.error({ name, err: loggable(err) }, "deleting custom component failed");
        return { ok: false, summary: UNAVAILABLE };
      }
      ctx.log.info({ name }, "custom component deleted");
      return { ok: true, summary: `Deleted ${name}; it can be restored from the Components panel` };
    },
  };
}
