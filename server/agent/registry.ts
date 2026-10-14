import type { ToolResult } from "shared/api";
import { compileSchema, formatSchemaErrors, schemaProblem } from "../validation/jsonSchema";
import type { ToolContext, ToolDefinition, ToolRegistry } from "./tools";

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Results whose `data` serializes longer than this are cut down to a note. */
export const MAX_RESULT_DATA_CHARS = 16_384;

/**
 * Build a registry from tool definitions. Throws on a duplicate or malformed
 * name, or an `input_schema` that is not a valid, closed object schema.
 * Arguments are validated before a handler runs, a throwing handler becomes an
 * `ok: false` result, and oversized `data` is replaced with a note.
 */
export function createToolRegistry(definitions: ToolDefinition[]): ToolRegistry {
  const byName = new Map<
    string,
    { def: ToolDefinition; validate: ReturnType<typeof compileSchema> }
  >();

  for (const def of definitions) {
    if (!NAME_PATTERN.test(def.name)) {
      throw new Error(`Tool name "${def.name}" must be snake_case (${NAME_PATTERN})`);
    }
    if (byName.has(def.name)) throw new Error(`Duplicate tool name "${def.name}"`);
    const schema = def.input_schema;
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      throw new Error(
        `Tool "${def.name}": input_schema must have type "object" and additionalProperties: false`,
      );
    }
    const problem = schemaProblem(schema);
    if (problem) throw new Error(`Tool "${def.name}": invalid input_schema: ${problem}`);
    byName.set(def.name, { def, validate: compileSchema(schema) });
  }

  return {
    specs: definitions.map(({ name, description, input_schema }) => ({
      name,
      description,
      input_schema,
    })),

    async run(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const entry = byName.get(name);
      if (!entry) return { ok: false, summary: `Unknown tool: ${name}` };

      if (!entry.validate(args)) {
        return {
          ok: false,
          summary: `Invalid arguments for ${name}`,
          data: { errors: formatSchemaErrors(entry.validate.errors) },
        };
      }

      const started = performance.now();
      let result: ToolResult;
      try {
        result = await entry.def.run(args, ctx);
      } catch (err) {
        ctx.log.error({ tool: name, err }, "tool failed");
        result = { ok: false, summary: `${name} failed` };
      }
      ctx.log.debug(
        { tool: name, durationMs: Math.round(performance.now() - started), ok: result.ok },
        "tool ran",
      );

      return capResultSize(result);
    },
  };
}

function capResultSize(result: ToolResult): ToolResult {
  if (result.data === undefined) return result;
  const size = JSON.stringify(result.data)?.length ?? 0;
  if (size <= MAX_RESULT_DATA_CHARS) return result;
  return { ...result, data: { truncated: true, note: "Result too large to return" } };
}
