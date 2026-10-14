import type { CatalogComponent } from "shared/components";
import { compileSchema, formatSchemaErrors, schemaProblem } from "../validation/jsonSchema";

const NAME_RE = /^[A-Z][A-Za-z0-9]*$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `prefix` plus a JSON Pointer as a dotted path: ("exampleProps", "/variant") → "exampleProps.variant". */
function dotted(prefix: string, pointer: string): string {
  return pointer === "/" ? prefix : prefix + pointer.replaceAll("/", ".");
}

/** Every problem with `value` against `schema`, as "<prefix>.<path> <message>". */
function valueProblems(schema: Record<string, unknown>, value: unknown, prefix: string): string[] {
  const validate = compileSchema(schema);
  if (validate(value)) return [];
  return formatSchemaErrors(validate.errors).map((e) => `${dotted(prefix, e.path)} ${e.message}`);
}

function componentProblems(component: CatalogComponent): string[] {
  const problems: string[] = [];
  const { name, description, propsSchema, exampleProps } = component;

  if (typeof name !== "string" || !NAME_RE.test(name)) {
    problems.push(`name must match ${NAME_RE.source}`);
  }
  if (typeof description !== "string" || description.trim() === "") {
    problems.push("description must not be empty");
  }

  const schemaError = schemaProblem(propsSchema);
  if (schemaError) {
    problems.push(`propsSchema is not a valid JSON Schema: ${schemaError}`);
    return problems;
  }
  const schema = propsSchema as unknown as Record<string, unknown>;
  if (schema.type !== "object") problems.push('propsSchema.type must be "object"');
  if (schema.additionalProperties !== false) {
    problems.push("propsSchema.additionalProperties must be false");
  }

  const properties = isObject(schema.properties) ? schema.properties : {};
  for (const [prop, propSchema] of Object.entries(properties)) {
    const path = `propsSchema.properties.${prop}`;
    if (!isObject(propSchema)) continue; // boolean schemas: nothing to describe or default
    if (typeof propSchema.description !== "string" || propSchema.description.trim() === "") {
      problems.push(`${path}.description must not be empty`);
    }
    if ("default" in propSchema) {
      problems.push(...valueProblems(propSchema, propSchema.default, `${path}.default`));
    }
  }

  problems.push(...valueProblems(schema, exampleProps, "exampleProps"));
  return problems;
}

/**
 * Checks the catalog against the rules every entry follows. Returns one
 * message per problem, prefixed with the component name; empty when valid.
 */
export function validateCatalog(catalog: readonly CatalogComponent[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const component of catalog) {
    const label = component.name || "(unnamed)";
    if (seen.has(component.name)) problems.push(`${label}: name is used more than once`);
    seen.add(component.name);
    problems.push(...componentProblems(component).map((p) => `${label}: ${p}`));
  }
  return problems;
}
