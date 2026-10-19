import type { ActionResult } from "shared/api";
import { compileSchema, formatSchemaErrors, schemaProblem } from "../validation/jsonSchema";
import type { ActionContext, ActionDefinition, ActionRegistry } from "./types";

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const PROPERTY_TYPES = new Set(["string", "boolean"]);

/** How long a handler may run before its result is "took too long". */
export const ACTION_TIMEOUT_MS = 10_000;

/** Longer result messages are cut to this many characters. */
export const MAX_ACTION_MESSAGE_CHARS = 500;

/**
 * Build a registry from action definitions. Throws on a duplicate or malformed
 * name, or an `input_schema` that is not a valid, closed object schema whose
 * properties are all strings or booleans with a `description`.
 *
 * Values are checked against the schema before a handler runs, so handlers get
 * only schema-checked string and boolean values. They still come from a
 * browser: handlers must use parameterised queries and never a shell.
 *
 * A throwing handler, or one still running after `timeoutMs` (its signal is
 * then aborted), becomes an `ok: false` result; messages are capped at
 * `MAX_ACTION_MESSAGE_CHARS`.
 */
export function createActionRegistry(
  definitions: ActionDefinition[],
  { timeoutMs = ACTION_TIMEOUT_MS }: { timeoutMs?: number } = {},
): ActionRegistry {
  const byName = new Map<
    string,
    { def: ActionDefinition; validate: ReturnType<typeof compileSchema> }
  >();

  for (const def of definitions) {
    if (!NAME_PATTERN.test(def.name)) {
      throw new Error(`Action name "${def.name}" must be snake_case (${NAME_PATTERN})`);
    }
    if (byName.has(def.name)) throw new Error(`Duplicate action name "${def.name}"`);
    const schema = def.input_schema;
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      throw new Error(
        `Action "${def.name}": input_schema must have type "object" and additionalProperties: false`,
      );
    }
    const problem = schemaProblem(schema);
    if (problem) throw new Error(`Action "${def.name}": invalid input_schema: ${problem}`);
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    for (const [key, prop] of Object.entries(properties)) {
      if (typeof prop.type !== "string" || !PROPERTY_TYPES.has(prop.type)) {
        throw new Error(`Action "${def.name}": property "${key}" must be a string or boolean`);
      }
      if (typeof prop.description !== "string" || prop.description === "") {
        throw new Error(`Action "${def.name}": property "${key}" needs a description`);
      }
    }
    byName.set(def.name, { def, validate: compileSchema(schema) });
  }

  return {
    specs: definitions.map(({ name, description, input_schema }) => ({
      name,
      description,
      input_schema,
    })),

    async run(
      name: string,
      values: Record<string, unknown>,
      ctx: ActionContext,
    ): Promise<ActionResult> {
      const entry = byName.get(name);
      if (!entry) return capMessage({ ok: false, message: `Unknown action: ${name}` });

      if (!entry.validate(values)) {
        const problems = formatSchemaErrors(entry.validate.errors)
          .map((e) => `${e.path} ${e.message}`)
          .join("; ");
        return capMessage({ ok: false, message: `Invalid values for ${name}: ${problems}` });
      }

      const timeout = new AbortController();
      const signal = AbortSignal.any([ctx.signal, timeout.signal]);
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<ActionResult>((resolve) => {
        timer = setTimeout(() => {
          // Settle first, so a handler that rejects on abort doesn't win the race.
          resolve({ ok: false, message: "That action took too long." });
          timeout.abort();
          ctx.log.error({ action: name, timeoutMs }, "action timed out");
        }, timeoutMs);
      });

      try {
        const handled = entry.def.run(values as Record<string, string | boolean>, {
          ...ctx,
          signal,
        });
        return capMessage(await Promise.race([handled, timedOut]));
      } catch (err) {
        ctx.log.error({ action: name, err }, "action failed");
        return { ok: false, message: "That action failed." };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function capMessage(result: ActionResult): ActionResult {
  if (result.message.length <= MAX_ACTION_MESSAGE_CHARS) return result;
  return { ...result, message: result.message.slice(0, MAX_ACTION_MESSAGE_CHARS) };
}
