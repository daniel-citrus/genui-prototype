import type { ErrorObject, ValidateFunction } from "ajv";
import type { Component } from "shared/components";
import { sendsInput } from "shared/formScope";
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
  return [`${first} (see ${name}'s propsSchema)`, ...rest];
}

/** A Select's `value` must be one of its options, and a disabled Select needs one. */
function selectValueProblems(props: Record<string, unknown>, path: string): string[] {
  const { value, options, disabled } = props;
  if (typeof value === "string") {
    return (options as string[]).includes(value) ? [] : [`${path}.props.value "${value}" is not one of its options`];
  }
  return disabled === true ? [`${path} a disabled Select needs a value`] : [];
}

/** A Tabs needs one child per label. Children that aren't an array have their own problem. */
function tabsPanelProblems(props: Record<string, unknown>, children: unknown, path: string): string[] {
  const panels = children === undefined ? [] : children;
  if (!Array.isArray(panels)) return [];
  const labels = (props.labels as string[]).length;
  return panels.length === labels
    ? []
    : [`${path} Tabs has ${labels} labels and ${panels.length} children: give exactly one child per label, in the same order`];
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
 * Problems with a tree's `name` and `action` props: always duplicate names (in
 * one Card, or in different Cards that one button would send together) and
 * inputs in a Tabs panel or Collapsible that a Button outside it sends (for
 * Buttons that aren't disabled); with `actions`, also unregistered actions,
 * required action properties no input fills and `edit` actions with no input
 * for any optional property (both for Buttons that aren't disabled, against the
 * inputs each one sends, and only with `designChecks`), inputs of the wrong
 * kind for the action property they fill, and, for dropdown sources
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

  const enabled = buttons.filter((b) => !b.disabled);
  inputs.forEach((input, i) => {
    const earlier = inputs.slice(0, i).filter((other) => other.name === input.name);
    const same = earlier.find((other) => other.card === input.card);
    if (same) {
      problems.push(`${keyPath(input, "name")} "${input.name}" is already used by ${same.path}`);
      return;
    }
    for (const other of earlier) {
      const button = enabled.find(
        (b) => sendsInput(tree, b.path, input.path) && sendsInput(tree, b.path, other.path),
      );
      if (button) {
        problems.push(
          `${keyPath(input, "name")} "${input.name}" is also at ${other.path}, and the button at ${button.path} would send both; put each form in its own Card`,
        );
        return;
      }
    }
  });
  for (const button of enabled) {
    for (const input of inputs) {
      const panel = input.panels?.find((p) => !button.panels?.includes(p));
      if (panel && sendsInput(tree, button.path, input.path)) {
        problems.push(
          `${input.path} is in the Tabs panel or Collapsible at ${panel}, but the button at ${button.path} (action "${button.action}") that sends it is outside, and the page won't send a field the person can't see; put the form's inputs and its button in the same tab or section`,
        );
      }
    }
  }
  if (!actions) return problems;

  const specs = new Map(actions.map((a) => [a.name, a]));
  const used = new Set<ActionSpec>();
  for (const button of buttons) {
    const spec = specs.get(button.action);
    if (!spec) {
      problems.push(
        `${keyPath(button, "action")} "${button.action}" is not a registered action (use a listed action, or leave it out)`,
      );
      continue;
    }
    used.add(spec);
  }

  const optionsChecked = new Set<string>();
  for (const spec of used) {
    const schema = spec.input_schema as {
      properties?: Record<string, { type?: unknown }>;
      required?: string[];
    };
    const required = schema.required ?? [];
    const optional = Object.keys(schema.properties ?? {}).filter((key) => !required.includes(key));
    for (const button of designChecks ? enabled.filter((b) => b.action === spec.name) : []) {
      const names = new Set(
        inputs.filter((input) => sendsInput(tree, button.path, input.path)).map((input) => input.name),
      );
      const where = button.card ? " in its Card" : "";
      for (const key of required) {
        if (!names.has(key)) {
          const source = spec.choices?.[key];
          if (typeof source === "string" && source !== "") {
            problems.push(
              `${button.path} action "${spec.name}" needs a Select named "${key}"${where}, with the ${source} values as its options, and none has that name`,
            );
          } else {
            problems.push(`${button.path} action "${spec.name}" needs an input named "${key}"${where}, and none has that name`);
          }
        }
      }
      if (spec.operation === "edit" && optional.length > 0 && !optional.some((key) => names.has(key))) {
        problems.push(
          `${button.path} action "${spec.name}" changes nothing without an input for one of: ${optional.join(", ")}`,
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
            `${keyPath(input, "options")} "${option}" is not one of the ${source} values (use the listed values)`,
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
        const problems = propsErrors(propsValidator(component), node.props, path);
        errors.push(...withPropsHint(problems, component.name, hinted));
        if (component.name === "Select" && problems.length === 0) errors.push(...selectValueProblems(node.props, path));
        if (component.name === "Tabs" && problems.length === 0) {
          errors.push(...tabsPanelProblems(node.props, node.children, path));
        }
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
