import type { ErrorObject, ValidateFunction } from "ajv";
import type { Component } from "shared/components";
import { compileSchema, formatSchemaErrors } from "../validation/jsonSchema";

/** Root is level 1. */
export const MAX_DEPTH = 8;
export const MAX_NODES = 100;
/** Errors returned at most; the last one summarizes the rest. */
export const MAX_ERRORS = 20;

export interface UiTreeStats {
  nodes: number;
  depth: number;
  /** Uses per component name. */
  components: Record<string, number>;
}

export interface UiTreeCheck {
  ok: boolean;
  errors: string[];
  stats: UiTreeStats;
}

const NODE_KEYS = new Set(["component", "props", "children"]);

// Compiled props validators by component name. Ajv caches by schema object
// identity and `list()` returns new objects every call, so compiling on every
// check would grow Ajv's cache without bound. One entry per name, replaced
// when `updatedAt` changes.
const validators = new Map<string, { updatedAt: string; validate: ValidateFunction }>();
let compiles = 0;

/** How many props validators have been compiled so far; for tests. */
export function validatorCompileCount(): number {
  return compiles;
}

function propsValidator(component: Component): ValidateFunction {
  const cached = validators.get(component.name);
  if (cached && cached.updatedAt === component.updatedAt) return cached.validate;
  const validate = compileSchema(component.propsSchema as unknown as Record<string, unknown>);
  compiles += 1;
  validators.set(component.name, { updatedAt: component.updatedAt, validate });
  return validate;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** "message" for one Ajv error; enums list their values. */
function propMessage(error: ErrorObject): string {
  if (error.keyword === "enum") {
    const allowed = (error.params as { allowedValues: unknown[] }).allowedValues;
    return `must be one of ${allowed.map(String).join(", ")}`;
  }
  return formatSchemaErrors([error])[0].message;
}

/** "/a/b" → ".a.b"; the root pointer "/" adds nothing. */
function dotted(pointer: string): string {
  return pointer === "/" ? "" : pointer.replaceAll("/", ".");
}

function propsProblems(component: Component, props: Record<string, unknown>, path: string): string[] {
  const validate = propsValidator(component);
  if (validate(props)) return [];
  return (validate.errors ?? []).map((error) => {
    const [formatted] = formatSchemaErrors([error]);
    return `${path}.props${dotted(formatted.path)} ${propMessage(error)}`;
  });
}

/**
 * Checks a UI tree against the catalog: shape, component names, props, which
 * components take children, and size limits. Walks the whole tree and reports
 * every problem (at most MAX_ERRORS entries).
 */
export function validateUiTree(tree: unknown, catalog: Component[]): UiTreeCheck {
  const byName = new Map(catalog.map((c) => [c.name, c]));
  const errors: string[] = [];
  const stats: UiTreeStats = { nodes: 0, depth: 0, components: {} };

  const visit = (node: unknown, path: string, level: number): void => {
    if (!isObject(node)) {
      errors.push(`${path} must be an object with a "component" string`);
      return;
    }
    stats.nodes += 1;
    stats.depth = Math.max(stats.depth, level);

    for (const key of Object.keys(node)) {
      if (!NODE_KEYS.has(key)) errors.push(`${path}.${key} is not allowed (use component, props, children)`);
    }

    let component: Component | undefined;
    if (typeof node.component !== "string") {
      errors.push(`${path} must be an object with a "component" string`);
    } else {
      component = byName.get(node.component);
      if (component) {
        stats.components[component.name] = (stats.components[component.name] ?? 0) + 1;
      } else {
        const lower = node.component.toLowerCase();
        const match = catalog.find((c) => c.name.toLowerCase() === lower);
        errors.push(
          `${path}.component "${node.component}" is not in the catalog` +
            (match ? ` (did you mean ${match.name}?)` : ""),
        );
      }
    }

    if (node.props !== undefined) {
      if (!isObject(node.props)) errors.push(`${path}.props must be an object`);
      else if (component) errors.push(...propsProblems(component, node.props, path));
    } else if (component) {
      errors.push(...propsProblems(component, {}, path));
    }

    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) {
        errors.push(`${path}.children must be an array`);
      } else {
        if (component?.children === "none") errors.push(`${path} ${component.name} cannot have children`);
        node.children.forEach((child, i) => visit(child, `${path}.children.${i}`, level + 1));
      }
    }
  };

  visit(tree, "tree", 1);

  const limits: string[] = [];
  if (stats.depth > MAX_DEPTH) limits.push(`tree is ${stats.depth} levels deep (max ${MAX_DEPTH})`);
  if (stats.nodes > MAX_NODES) limits.push(`tree has ${stats.nodes} nodes (max ${MAX_NODES})`);
  const all = [...limits, ...errors];

  const shown =
    all.length > MAX_ERRORS
      ? [...all.slice(0, MAX_ERRORS - 1), `…and ${all.length - (MAX_ERRORS - 1)} more`]
      : all;
  return { ok: all.length === 0, errors: shown, stats };
}
