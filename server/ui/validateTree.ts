import type { ErrorObject, ValidateFunction } from "ajv";
import type { Component } from "shared/components";
import type { ActionSpec } from "../actions/types";
import { compileSchema, formatSchemaErrors } from "../validation/jsonSchema";
import { collectBindings, isObject, type ActionButton, type NamedInput } from "./bindings";
import { validateMarkup } from "./markup";

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

export interface UiTreeOptions {
  /**
   * false skips the checks that only make sense for a whole design: action
   * properties no input fills, and edit forms with nothing to change.
   * Default true.
   */
  designChecks?: boolean;
  /** Default MAX_NODES. */
  maxNodes?: number;
  /** Default MAX_DEPTH. */
  maxDepth?: number;
  /** Names besides the catalog's that an unknown component may be offered as ("did you mean X?"). */
  suggestions?: string[];
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

/** At most MAX_ERRORS of `errors`; when there are more, the last one says how many were left out. */
export function limitErrors(errors: string[]): string[] {
  return errors.length > MAX_ERRORS
    ? [...errors.slice(0, MAX_ERRORS - 1), `…and ${errors.length - (MAX_ERRORS - 1)} more`]
    : errors;
}

/** The size limits a tree with `stats` goes over, as problems. */
export function sizeProblems(
  stats: Pick<UiTreeStats, "nodes" | "depth">,
  maxNodes = MAX_NODES,
  maxDepth = MAX_DEPTH,
): string[] {
  const problems: string[] = [];
  if (stats.depth > maxDepth) problems.push(`tree is ${stats.depth} levels deep (max ${maxDepth})`);
  if (stats.nodes > maxNodes) problems.push(`tree has ${stats.nodes} nodes (max ${maxNodes})`);
  return problems;
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

/** Every problem `validate` finds in `props`, as "<path>.props.<prop> <message>". */
export function propsErrors(validate: ValidateFunction, props: unknown, path: string): string[] {
  if (validate(props)) return [];
  return (validate.errors ?? []).map((error) => {
    const [formatted] = formatSchemaErrors([error]);
    return `${path}.props${dotted(formatted.path)} ${propMessage(error)}`;
  });
}

/**
 * `problems` from `propsErrors` for a use of `name`, the first one saying
 * where to read its props unless `hinted` already has `name`. Adds `name` to
 * `hinted`, so one check names each component once.
 */
export function withPropsHint(problems: string[], name: string, hinted: Set<string>): string[] {
  if (problems.length === 0 || hinted.has(name)) return problems;
  hinted.add(name);
  const [first, ...rest] = problems;
  return [`${first} (call get_component ${name} for its props)`, ...rest];
}

/** Where a binding's key is set: a catalog prop, or the part of a Markup element that holds it. */
const MARKUP_KEY_PATHS = { name: "attrs.name", action: "action", options: "children" };
function keyPath(binding: NamedInput | ActionButton, key: keyof typeof MARKUP_KEY_PATHS): string {
  return `${binding.path}.${binding.markup ? MARKUP_KEY_PATHS[key] : `props.${key}`}`;
}

/** Why `input` can't fill `action`'s `type` property, or undefined if it can. */
function bindingMismatch(input: NamedInput, action: string, type: unknown): string | undefined {
  const at = `${input.path} ${input.component} named "${input.name}"`;
  if (input.component === "TextInput" && input.type === "password") {
    return `${at} is a password field, which can't send its value to action "${action}"`;
  }
  if (type === "boolean" && input.component !== "Checkbox") {
    return `${at} fills a boolean of action "${action}": use a Checkbox`;
  }
  if (type === "string" && input.component === "Checkbox") {
    return `${at} fills a string of action "${action}": use a TextInput or Select`;
  }
  return undefined;
}

/**
 * Problems with a tree's `name` and `action` props: duplicate names always;
 * with `actions`, also unregistered actions, required action properties no
 * input fills and `edit` actions with no input for any optional property (both
 * for Buttons that aren't disabled, and only with `designChecks`), inputs of
 * the wrong kind for the action property they fill, and, for dropdown sources
 * in `choiceValues`, inputs that aren't a Select or list an option the source
 * doesn't have.
 */
function bindingProblems(
  tree: unknown,
  actions: ActionSpec[] | undefined,
  choiceValues: Record<string, string[]> | undefined,
  designChecks: boolean,
): string[] {
  const { inputs, buttons } = collectBindings(tree);
  const problems: string[] = [];

  const byName = new Map<string, NamedInput>();
  for (const input of inputs) {
    const first = byName.get(input.name);
    if (first) problems.push(`${keyPath(input, "name")} "${input.name}" is already used by ${first.path}`);
    else byName.set(input.name, input);
  }
  if (!actions) return problems;

  const specs = new Map(actions.map((a) => [a.name, a]));
  const used = new Set<ActionSpec>();
  // Each action's first Button that isn't disabled.
  const enabledAt = new Map<ActionSpec, string>();
  for (const button of buttons) {
    const spec = specs.get(button.action);
    if (!spec) {
      problems.push(
        `${keyPath(button, "action")} "${button.action}" is not a registered action (call list_actions to see them)`,
      );
      continue;
    }
    used.add(spec);
    if (!button.disabled && !enabledAt.has(spec)) enabledAt.set(spec, button.path);
  }

  const optionsChecked = new Set<string>();
  for (const spec of used) {
    const schema = spec.input_schema as {
      properties?: Record<string, { type?: unknown }>;
      required?: string[];
    };
    const required = schema.required ?? [];
    const path = enabledAt.get(spec);
    if (path && designChecks) {
      for (const key of required) {
        if (!byName.has(key)) {
          problems.push(`${path} action "${spec.name}" needs an input named "${key}", and none has that name`);
        }
      }
      const optional = Object.keys(schema.properties ?? {}).filter((key) => !required.includes(key));
      if (spec.operation === "edit" && optional.length > 0 && !optional.some((key) => byName.has(key))) {
        problems.push(
          `${path} action "${spec.name}" changes nothing without an input for one of: ${optional.join(", ")}`,
        );
      }
    }
    for (const input of inputs) {
      const property = schema.properties?.[input.name];
      if (!property) continue;
      const source = spec.choices?.[input.name];
      const values = source ? choiceValues?.[source] : undefined;
      if (values && input.component !== "Select") {
        problems.push(
          `${input.path} fills "${input.name}" of action "${spec.name}", which takes one of the ${source} values: use a Select with those values as options`,
        );
        continue;
      }
      const mismatch = bindingMismatch(input, spec.name, property.type);
      if (mismatch) problems.push(mismatch);
      // Options don't depend on the action: check each input against a source once.
      const checkKey = `${input.path} ${source}`;
      if (!values || optionsChecked.has(checkKey)) continue;
      optionsChecked.add(checkKey);
      for (const option of input.options ?? []) {
        if (!values.includes(option)) {
          problems.push(
            `${keyPath(input, "options")} "${option}" is not one of the ${source} values (call list_actions to get them)`,
          );
        }
      }
    }
  }
  return problems;
}

/**
 * Checks a UI tree against the catalog: shape, component names, props, which
 * components take children, size limits, and bindings (see `bindingProblems`;
 * action checks only when `actions` is given, dropdown checks only for the
 * sources in `choiceValues`, source name → its current values), and each
 * Markup node's `root` (whose elements don't count toward the node and depth
 * limits). Walks the whole tree and reports every problem (at most MAX_ERRORS
 * entries).
 */
export function validateUiTree(
  tree: unknown,
  catalog: Component[],
  actions?: ActionSpec[],
  choiceValues?: Record<string, string[]>,
  options: UiTreeOptions = {},
): UiTreeCheck {
  const { designChecks = true, maxNodes = MAX_NODES, maxDepth = MAX_DEPTH, suggestions = [] } = options;
  const byName = new Map(catalog.map((c) => [c.name, c]));
  const errors: string[] = [];
  const hinted = new Set<string>();
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
        const match = [...byName.keys(), ...suggestions].find((name) => name.toLowerCase() === lower);
        errors.push(
          `${path}.component "${node.component}" is not in the catalog` +
            (match ? ` (did you mean ${match}?)` : ""),
        );
      }
    }

    if (node.props !== undefined) {
      if (!isObject(node.props)) {
        errors.push(`${path}.props must be an object`);
      } else if (component) {
        errors.push(...withPropsHint(propsErrors(propsValidator(component), node.props, path), component.name, hinted));
        if (component.name === "Markup" && isObject(node.props.root)) {
          errors.push(...validateMarkup(node.props.root, `${path}.props.root`));
        }
      }
    } else if (component) {
      errors.push(...withPropsHint(propsErrors(propsValidator(component), {}, path), component.name, hinted));
    }

    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) {
        errors.push(`${path}.children must be an array`);
      } else {
        if (component?.children === "none" && node.children.length > 0) errors.push(`${path} ${component.name} cannot have children`);
        node.children.forEach((child, i) => visit(child, `${path}.children.${i}`, level + 1));
      }
    }
  };

  visit(tree, "tree", 1);
  errors.push(...bindingProblems(tree, actions, choiceValues, designChecks));

  const all = [...sizeProblems(stats, maxNodes, maxDepth), ...errors];
  return { ok: all.length === 0, errors: limitErrors(all), stats };
}
