import type { ActionResult } from "shared/api";
import { compileSchema, formatSchemaErrors, schemaProblem } from "../validation/jsonSchema";
import { CONFIRM_PLACEHOLDER } from "./confirm";
import {
  ACTION_OPERATIONS,
  type ActionContext,
  type ActionDefinition,
  type ActionRegistry,
  type ChoiceSource,
} from "./types";

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const PROPERTY_TYPES = new Set(["string", "boolean"]);
const MAX_AREA_CHARS = 32;
const MAX_CONFIRM_CHARS = 200;

/** How long a handler may run before its result is "took too long". */
export const ACTION_TIMEOUT_MS = 10_000;

/** Longer result messages are cut to this many characters. */
export const MAX_ACTION_MESSAGE_CHARS = 500;

/**
 * Build a registry from action definitions. Throws on a duplicate or malformed
 * name, an `input_schema` that is not a valid, closed object schema whose
 * properties are all strings or booleans with a `description`, a malformed
 * `area` or `operation`, a `choices` input that is not a declared string, a
 * malformed source name or two sources sharing one, or a `confirm` that is
 * empty, too long, or names an undeclared property.
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
  const sources = new Map<string, ChoiceSource>();

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
    if (
      def.area !== undefined &&
      (typeof def.area !== "string" || !NAME_PATTERN.test(def.area) || def.area.length > MAX_AREA_CHARS)
    ) {
      throw new Error(
        `Action "${def.name}": area must be snake_case (${NAME_PATTERN}) and at most ${MAX_AREA_CHARS} characters`,
      );
    }
    if (def.operation !== undefined && !ACTION_OPERATIONS.includes(def.operation)) {
      throw new Error(`Action "${def.name}": operation must be one of ${ACTION_OPERATIONS.join(", ")}`);
    }
    for (const [key, source] of Object.entries(def.choices ?? {})) {
      if (!Object.hasOwn(properties, key) || properties[key]?.type !== "string") {
        throw new Error(`Action "${def.name}": choices input "${key}" must be a declared string property`);
      }
      if (!NAME_PATTERN.test(source.name)) {
        throw new Error(`Action "${def.name}": choice source "${source.name}" must be snake_case (${NAME_PATTERN})`);
      }
      const known = sources.get(source.name);
      if (known && known !== source) {
        throw new Error(`Action "${def.name}": another choice source is already named "${source.name}"`);
      }
      sources.set(source.name, source);
    }
    if (def.confirm !== undefined) {
      if (typeof def.confirm !== "string" || def.confirm === "" || def.confirm.length > MAX_CONFIRM_CHARS) {
        throw new Error(
          `Action "${def.name}": confirm must be a non-empty string of at most ${MAX_CONFIRM_CHARS} characters`,
        );
      }
      for (const [, name] of def.confirm.matchAll(CONFIRM_PLACEHOLDER)) {
        if (!Object.hasOwn(properties, name)) {
          throw new Error(`Action "${def.name}": confirm placeholder "{${name}}" is not a declared property`);
        }
      }
    }
    byName.set(def.name, { def, validate: compileSchema(schema) });
  }

  return {
    specs: definitions.map(({ name, description, input_schema, area, operation, choices, confirm }) => ({
      name,
      description,
      input_schema,
      ...(area !== undefined && { area }),
      ...(operation !== undefined && { operation }),
      ...(choices !== undefined && {
        choices: Object.fromEntries(Object.entries(choices).map(([key, source]) => [key, source.name])),
      }),
      ...(confirm !== undefined && { confirm }),
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

    async listChoices(source: string, signal: AbortSignal): Promise<string[]> {
      const found = sources.get(source);
      if (!found) throw new Error(`Unknown choice source: ${source}`);
      return found.list(signal);
    },
  };
}

function capMessage(result: ActionResult): ActionResult {
  if (result.message.length <= MAX_ACTION_MESSAGE_CHARS) return result;
  return { ...result, message: result.message.slice(0, MAX_ACTION_MESSAGE_CHARS) };
}
