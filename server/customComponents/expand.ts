import type { ValidateFunction } from "ajv";
import type { Component } from "shared/components";
import { MAX_CUSTOM_NESTING, MAX_EXPANDED_NODES, type StoredCustomComponent } from "shared/customComponents";
import { isPlaceholder } from "shared/markup";
import type { UiNode } from "shared/ui";
import { isObject } from "../ui/bindings";
import { propsErrors } from "../ui/validateTree";
import { compileSchema } from "../validation/jsonSchema";

export type ResolveCustomComponent = (name: string) => Promise<StoredCustomComponent | undefined>;

export interface ExpandContext {
  catalog: Component[];
  /** The current version by exact name, deleted ones included. */
  resolve: ResolveCustomComponent;
}

export interface Expansion {
  /**
   * Catalog components only, apart from names that are neither catalog nor
   * custom (left for `validateUiTree` to report). A refused custom node is
   * left out, so validating `tree` doesn't report it again; null when that
   * is the root.
   */
  tree: UiNode | null;
  /** Instance props, children, deleted components, loops, nesting and size. */
  errors: string[];
  /** Expanded-tree path prefix → label used to rewrite validator messages. */
  origins: Map<string, string>;
}

/** A `{ "$children": true }` slot, or something meant as one. */
export function isSlot(value: unknown): value is Record<string, unknown> {
  return isObject(value) && "$children" in value;
}

export function deletedProblem(path: string, name: string): string {
  return `${path}.component "${name}" was deleted; restore it in the Components panel or use another component`;
}

/** `resolve`, asked at most once per name. */
export function cachedResolve(resolve: ResolveCustomComponent): ResolveCustomComponent {
  const found = new Map<string, Promise<StoredCustomComponent | undefined>>();
  return (name) => {
    let result = found.get(name);
    if (!result) {
      result = resolve(name);
      found.set(name, result);
    }
    return result;
  };
}

// Compiled props validators by custom component name. `resolve` returns new
// objects every call and Ajv caches by object identity, so compiling on every
// expansion would grow Ajv's cache without bound. One entry per name, replaced
// when its props schema changes.
const validators = new Map<string, { schema: string; validate: ValidateFunction }>();

function propsValidator(custom: StoredCustomComponent): ValidateFunction {
  const schema = JSON.stringify(custom.propsSchema);
  const cached = validators.get(custom.name);
  if (cached?.schema === schema) return cached.validate;
  const validate = compileSchema(custom.propsSchema as unknown as Record<string, unknown>);
  validators.set(custom.name, { schema, validate });
  return validate;
}

/** An instance child put in a template's slot; expanded as part of the instance's own tree. */
class SlotChild {
  readonly node: unknown;
  readonly where: string;
  readonly stack: string[];

  constructor(node: unknown, where: string, stack: string[]) {
    this.node = node;
    this.where = where;
    this.stack = stack;
  }
}

type PropValue = (placeholder: Record<string, unknown>) => unknown;

/** `values` with each placeholder filled; one that fills to undefined is left out. */
function fillValues(values: Record<string, unknown>, value: PropValue): Record<string, unknown> {
  const filled: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(values)) {
    const result = isPlaceholder(v) ? value(v) : v;
    if (result !== undefined) filled[key] = result;
  }
  return filled;
}

/** A copy of a Markup element with its text, attribute and style placeholders filled. */
function fillMarkup(element: unknown, value: PropValue): unknown {
  if (!isObject(element)) return element;
  const filled: Record<string, unknown> = { ...element };
  if (isPlaceholder(element.text)) {
    const text = value(element.text);
    if (text === undefined) delete filled.text;
    else filled.text = text;
  }
  if (isObject(element.attrs)) filled.attrs = fillValues(element.attrs, value);
  if (isObject(element.style)) filled.style = fillValues(element.style, value);
  if (Array.isArray(element.children)) filled.children = element.children.map((child) => fillMarkup(child, value));
  return filled;
}

/** A copy of a template node with its placeholders filled and its slot replaced by `slot`. */
function fillTemplate(node: unknown, value: PropValue, slot: SlotChild[]): unknown {
  if (!isObject(node)) return node;
  const filled: Record<string, unknown> = { ...node };
  if (isObject(node.props)) {
    const props = fillValues(node.props, value);
    const { root } = node.props;
    if (node.component === "Markup" && isObject(root) && !isPlaceholder(root)) props.root = fillMarkup(root, value);
    filled.props = props;
  }
  if (Array.isArray(node.children)) {
    filled.children = node.children.flatMap((child) => (isSlot(child) ? slot : [fillTemplate(child, value, slot)]));
  }
  return filled;
}

const NODE_KEYS = ["component", "props", "children"];

/**
 * Replaces every custom component in `tree` with its current version's
 * template, filled with the instance's props and children, until only
 * catalog components are left. Catalog names win over custom ones. Problems
 * use the agent's paths: its own path for a node it wrote, and
 * "<path> (<Name> v<version>) template…" for one from a template. Templates
 * may use deleted components; the agent's own tree may not.
 */
export async function expandTree(tree: unknown, ctx: ExpandContext): Promise<Expansion> {
  const catalog = new Set(ctx.catalog.map((c) => c.name));
  const resolve = cachedResolve(ctx.resolve);
  const errors: string[] = [];
  const origins = new Map<string, string>();
  let nodes = 0;
  let tooMany = false;

  // `node` expanded at path `at`, or undefined when it's refused. `where` is
  // its path for the agent; `stack` lists the custom components whose
  // templates it's in, outermost first.
  const expand = async (node: unknown, where: string, at: string, stack: string[]): Promise<unknown> => {
    if (!isObject(node)) return node;
    if (typeof node.component === "string" && !catalog.has(node.component)) {
      const custom = await resolve(node.component);
      if (custom) return expandCustom(node, custom, where, at, stack);
    }
    nodes += 1;
    if (!Array.isArray(node.children)) return { ...node };
    return { ...node, children: await expandChildren(node.children, where, at, stack) };
  };

  const expandChildren = async (children: unknown[], where: string, at: string, stack: string[]) => {
    const expanded: unknown[] = [];
    for (const [i, child] of children.entries()) {
      const path = `${at}.children.${expanded.length}`;
      const slotted = child instanceof SlotChild;
      const childWhere = slotted ? child.where : `${where}.children.${i}`;
      // A slot or a refused sibling moves the child: map its new path back.
      if (slotted || expanded.length !== i) origins.set(path, childWhere);
      const result = slotted
        ? await expand(child.node, childWhere, path, child.stack)
        : await expand(child, childWhere, path, stack);
      if (result === undefined) origins.delete(path);
      else expanded.push(result);
    }
    return expanded;
  };

  const expandCustom = async (
    node: Record<string, unknown>,
    custom: StoredCustomComponent,
    where: string,
    at: string,
    stack: string[],
  ): Promise<unknown> => {
    const { name } = custom;
    if (stack.includes(name)) {
      const loop = [...stack.slice(stack.indexOf(name)), name].join(" → ");
      errors.push(`${where}.component "${name}" makes a loop: ${loop}`);
      return undefined;
    }
    if (stack.length >= MAX_CUSTOM_NESTING) {
      const levels = `${stack.length + 1} levels deep (max ${MAX_CUSTOM_NESTING})`;
      errors.push(`${where}.component "${name}" nests custom components ${levels}: ${[...stack, name].join(" → ")}`);
      return undefined;
    }

    const problems: string[] = [];
    if (stack.length === 0 && custom.deletedAt !== null) problems.push(deletedProblem(where, name));
    for (const key of Object.keys(node)) {
      if (!NODE_KEYS.includes(key)) problems.push(`${where}.${key} is not allowed (use component, props, children)`);
    }
    if (node.props !== undefined && !isObject(node.props)) problems.push(`${where}.props must be an object`);
    else problems.push(...propsErrors(propsValidator(custom), node.props ?? {}, where));
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) problems.push(`${where}.children must be an array`);
      else if (custom.children === "none") problems.push(`${where} ${name} cannot have children`);
    }
    if (problems.length > 0) {
      errors.push(...problems);
      return undefined;
    }
    if (nodes >= MAX_EXPANDED_NODES) {
      if (!tooMany) {
        errors.push(`${where} was not expanded: the expanded tree reached ${MAX_EXPANDED_NODES} nodes (max)`);
      }
      tooMany = true;
      return undefined;
    }

    const props = isObject(node.props) ? node.props : {};
    const declared: Record<string, unknown> = custom.propsSchema.properties ?? {};
    const value: PropValue = ({ $prop: prop }) => {
      if (typeof prop !== "string") return undefined;
      if (Object.hasOwn(props, prop)) return props[prop];
      const schema = Object.hasOwn(declared, prop) ? declared[prop] : undefined;
      return isObject(schema) ? schema.default : undefined;
    };
    const slot = Array.isArray(node.children)
      ? node.children.map((child, i) => new SlotChild(child, `${where}.children.${i}`, stack))
      : [];
    const label = `${where} (${name} v${custom.version}) template`;
    origins.set(at, label);
    const result = await expand(fillTemplate(custom.template, value, slot), label, at, [...stack, name]);
    if (result === undefined) origins.delete(at);
    return result;
  };

  const expanded = await expand(tree, "tree", "tree", []);
  return { tree: (expanded ?? null) as UiNode | null, errors, origins };
}

// A path at the start of a message, or one with at least one segment after a space.
const PATH = /^tree(?:\.[\w$-]+)*|(?<=\s)tree(?:\.[\w$-]+)+/g;

/**
 * `errors` about an expanded tree, with each path replaced by the agent's:
 * the longest prefix found in `origins` is swapped for its label
 * ("tree.children.0 (MenuItemCard v3) template.children.1.props.text must be string").
 */
export function rewritePaths(errors: string[], origins: Map<string, string>): string[] {
  if (origins.size === 0) return errors;
  return errors.map((error) =>
    error.replace(PATH, (path) => {
      for (let end = path.length; end > 0; end = path.lastIndexOf(".", end - 1)) {
        const origin = origins.get(path.slice(0, end));
        if (origin !== undefined) return origin + path.slice(end);
      }
      return path;
    }),
  );
}
