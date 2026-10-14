import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";

// ajv-formats is CommonJS; depending on the loader its default import is the
// plugin itself or the module object with the plugin on `.default`.
const addFormats = ((addFormatsModule as unknown as { default?: typeof addFormatsModule })
  .default ?? addFormatsModule) as typeof addFormatsModule;

/**
 * The one Ajv instance the server uses: strict (unknown keywords and
 * ambiguous schemas are errors), reports every error, and knows the standard
 * formats (`uri`, `email`, `date-time`, ...).
 */
export const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);

/** A validation problem, short enough for a model or a person to act on. */
export interface SchemaError {
  /** JSON Pointer to the offending value; "/" is the root. */
  path: string;
  message: string;
}

/** Why `schema` is not a valid JSON Schema, or `null` when it is. */
export function schemaProblem(schema: unknown): string | null {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return "schema must be an object";
  }
  try {
    // Strict-mode checks (unknown keywords, ...) only run on compile.
    if (!ajv.validateSchema(schema)) return ajv.errorsText(ajv.errors);
    ajv.compile(schema);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Compile `schema` into a validator. Throws if the schema is invalid. */
export function compileSchema<T = unknown>(schema: Record<string, unknown>): ValidateFunction<T> {
  return ajv.compile<T>(schema);
}

/** Turn Ajv's errors into `{ path, message }` pairs. */
export function formatSchemaErrors(errors: ErrorObject[] | null | undefined): SchemaError[] {
  return (errors ?? []).map((e) => {
    if (e.keyword === "required") {
      const prop = String((e.params as { missingProperty: string }).missingProperty);
      return { path: `${e.instancePath}/${prop}`, message: "is required" };
    }
    if (e.keyword === "additionalProperties") {
      const prop = String((e.params as { additionalProperty: string }).additionalProperty);
      return { path: `${e.instancePath}/${prop}`, message: "is not allowed" };
    }
    return { path: e.instancePath || "/", message: e.message ?? "is invalid" };
  });
}
