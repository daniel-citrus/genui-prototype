import type { ComponentCategory, ComponentChildren } from "shared/components";
import {
  CUSTOM_COMPONENT_NAME,
  MAX_DEFINITION_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_EXPANDED_DEPTH,
  MAX_EXPANDED_NODES,
  MAX_TEMPLATE_DEPTH,
  MAX_TEMPLATE_NODES,
  type CustomComponentDefinition,
  type StoredCustomComponent,
} from "shared/customComponents";
import { isPlaceholder } from "shared/markup";
import type { ActionSpec } from "../actions/types";
import { propsSchemaProblems } from "../catalog/validate";
import { isObject } from "../ui/bindings";
import { omitEmptyChildren } from "../ui/omitEmptyChildren";
import { limitErrors, validateUiTree } from "../ui/validateTree";
import { cachedResolve, deletedProblem, type ExpandContext, expandTree, isSlot, rewritePaths } from "./expand";

const KEYS = ["name", "description", "category", "children", "propsSchema", "exampleProps", "template"];
const CATEGORIES: readonly ComponentCategory[] = ["layout", "text", "input", "display"];
const CHILDREN: readonly ComponentChildren[] = ["none", "any"];
const NODE_KEYS = ["component", "props", "children"];
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/** Paths of every `key` key in `value`, at any depth below `path`. */
function keyPaths(value: unknown, key: string, path: string): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => keyPaths(v, key, `${path}.${i}`));
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(k === key ? [`${path}.${k}`] : []),
    ...keyPaths(v, key, `${path}.${k}`),
  ]);
}

interface TemplateCheck {
  problems: string[];
  /** Every node whose component isn't a catalog name. */
  references: { path: string; name: string }[];
}

/**
 * The template's shape: nodes, size, where placeholders and the slot may go,
 * and that each placeholder names a declared prop. Custom nodes count as one
 * node; what they expand to isn't looked at here.
 */
function checkTemplate(
  template: unknown,
  declared: Record<string, unknown>,
  children: unknown,
  catalog: Set<string>,
): TemplateCheck {
  const problems: string[] = [];
  const references: TemplateCheck["references"] = [];
  let firstSlot: string | undefined;
  let slotSeen = false;
  let nodes = 0;
  let depth = 0;

  const placeholder = (value: Record<string, unknown>, path: string) => {
    const prop = value.$prop;
    if (Object.keys(value).length !== 1 || typeof prop !== "string") {
      problems.push(`${path} must be exactly {"$prop": "<name>"}`);
    } else if (!Object.hasOwn(declared, prop)) {
      problems.push(`${path} uses $prop "${prop}", which propsSchema.properties doesn't declare`);
    }
  };

  // Any placeholder or slot in `value` is in the wrong place.
  const misplaced = (value: unknown, path: string): void => {
    if (isPlaceholder(value)) {
      problems.push(
        `${path} {"$prop"} is only allowed as a whole prop value or a Markup text, attribute or style value`,
      );
    } else if (isSlot(value)) {
      slotSeen = true;
      problems.push(`${path} {"$children": true} is only allowed in a children array`);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => misplaced(v, `${path}.${i}`));
    } else if (isObject(value)) {
      for (const [key, v] of Object.entries(value)) misplaced(v, `${path}.${key}`);
    }
  };

  const fillable = (value: unknown, path: string) =>
    isPlaceholder(value) ? placeholder(value, path) : misplaced(value, path);

  const markup = (element: unknown, path: string): void => {
    if (!isObject(element) || isPlaceholder(element) || isSlot(element)) return misplaced(element, path);
    for (const [key, value] of Object.entries(element)) {
      const at = `${path}.${key}`;
      if (key === "text") fillable(value, at);
      else if ((key === "attrs" || key === "style") && isObject(value)) {
        for (const [name, v] of Object.entries(value)) fillable(v, `${at}.${name}`);
      } else if (key === "children" && Array.isArray(value)) value.forEach((child, i) => markup(child, `${at}.${i}`));
      else misplaced(value, at);
    }
  };

  const slot = (value: Record<string, unknown>, path: string) => {
    slotSeen = true;
    if (Object.keys(value).length !== 1 || value.$children !== true) {
      problems.push(`${path} must be exactly {"$children": true}`);
    } else if (children === "none") {
      problems.push(`${path} {"$children": true} is not allowed when children is "none"`);
    } else if (firstSlot) {
      problems.push(`${path} is a second {"$children": true} slot (${firstSlot} is the first; only one is allowed)`);
    } else {
      firstSlot = path;
    }
  };

  const node = (value: unknown, path: string, level: number): void => {
    if (!isObject(value) || typeof value.component !== "string") {
      problems.push(`${path} must be an object with a "component" string`);
      return;
    }
    nodes += 1;
    depth = Math.max(depth, level);
    const { component } = value;
    if (!catalog.has(component)) references.push({ path, name: component });
    for (const key of Object.keys(value)) {
      if (!NODE_KEYS.includes(key)) problems.push(`${path}.${key} is not allowed (use component, props, children)`);
    }

    if (value.props !== undefined) {
      if (!isObject(value.props)) problems.push(`${path}.props must be an object`);
      else {
        for (const [key, prop] of Object.entries(value.props)) {
          const at = `${path}.props.${key}`;
          if (component === "Markup" && key === "root" && !isPlaceholder(prop)) markup(prop, at);
          else fillable(prop, at);
        }
      }
    }
    if (value.children !== undefined) {
      if (!Array.isArray(value.children)) problems.push(`${path}.children must be an array`);
      else {
        value.children.forEach((child, i) => {
          const at = `${path}.children.${i}`;
          if (isSlot(child)) slot(child, at);
          else node(child, at, level + 1);
        });
      }
    }
  };

  if (isSlot(template)) misplaced(template, "template");
  else node(template, "template", 1);

  if (nodes > MAX_TEMPLATE_NODES) problems.push(`template has ${nodes} nodes (max ${MAX_TEMPLATE_NODES})`);
  if (depth > MAX_TEMPLATE_DEPTH) problems.push(`template is ${depth} levels deep (max ${MAX_TEMPLATE_DEPTH})`);
  if (children === "any" && !slotSeen) {
    problems.push('template needs a {"$children": true} slot in a children array, since children is "any"');
  }
  return { problems, references };
}

/**
 * Checks a custom component definition before it is saved: its keys, name,
 * description, category and children setting, its props schema and example
 * (the catalog's rules), its size, its template's shape and the components
 * it uses. When those leave the example check something to work with, the
 * template is then expanded with `exampleProps` and validated as a UI tree
 * against `actions`, without the design-level checks. Reports every problem
 * (at most MAX_ERRORS), with paths such as "template.children.1.props.text".
 * Reads custom components through `resolve` only.
 */
export async function validateDefinition(
  definition: unknown,
  ctx: ExpandContext & { actions: ActionSpec[] },
): Promise<{ ok: true; definition: CustomComponentDefinition } | { ok: false; errors: string[] }> {
  if (!isObject(definition)) return { ok: false, errors: ["definition must be an object"] };
  const { name, description, category, children, propsSchema, exampleProps, template } = definition;
  const problems: string[] = [];
  // The example check needs a usable name, schema, template and references.
  let expandable = true;

  for (const key of KEYS) if (!Object.hasOwn(definition, key)) problems.push(`${key} is required`);
  for (const key of Object.keys(definition)) if (!KEYS.includes(key)) problems.push(`${key} is not allowed`);

  if (typeof name !== "string" || !CUSTOM_COMPONENT_NAME.test(name)) {
    problems.push(`name must match ${CUSTOM_COMPONENT_NAME.source}`);
    expandable = false;
  }
  const lower = typeof name === "string" ? name.toLowerCase() : undefined;
  const catalogName = ctx.catalog.find((c) => c.name.toLowerCase() === lower)?.name;
  if (catalogName) {
    problems.push(`name "${String(name)}" is taken by the catalog component ${catalogName}`);
    expandable = false;
  }

  if (typeof description !== "string" || description.trim() === "") {
    problems.push("description must not be empty");
  } else {
    if (description.length > MAX_DESCRIPTION_CHARS) {
      problems.push(`description is ${description.length} characters (max ${MAX_DESCRIPTION_CHARS})`);
    }
    if (CONTROL_CHARACTERS.test(description)) {
      problems.push("description must be plain text, without line breaks or other control characters");
    }
  }
  if (!CATEGORIES.includes(category as ComponentCategory)) {
    problems.push(`category must be one of ${CATEGORIES.join(", ")}`);
  }
  if (!CHILDREN.includes(children as ComponentChildren)) problems.push('children must be "none" or "any"');

  // Ajv keeps every $id it compiles, and refuses to compile another schema with the same one.
  const ids = keyPaths(propsSchema, "$id", "propsSchema");
  const schemaProblems =
    ids.length > 0 ? ids.map((path) => `${path} is not allowed`) : propsSchemaProblems(propsSchema, exampleProps);
  problems.push(...schemaProblems);
  if (schemaProblems.length > 0) expandable = false;

  const size = JSON.stringify(definition).length;
  if (size > MAX_DEFINITION_CHARS) {
    problems.push(`definition is ${size} characters as JSON (max ${MAX_DEFINITION_CHARS})`);
  }

  const catalog = new Set(ctx.catalog.map((c) => c.name));
  const properties = isObject(propsSchema) && isObject(propsSchema.properties) ? propsSchema.properties : {};
  const shape = checkTemplate(template, properties, children, catalog);
  problems.push(...shape.problems);
  if (shape.problems.length > 0) expandable = false;

  // The definition stands in for its own name, so references back to it show up as loops.
  const candidate = {
    ...definition,
    version: 0,
    versions: 0,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  } as unknown as StoredCustomComponent;
  const resolveStored = cachedResolve(ctx.resolve);
  const resolve = (n: string) => (n === name ? Promise.resolve(candidate) : resolveStored(n));

  const childrenOf = new Map<string, ComponentChildren>(ctx.catalog.map((c) => [c.name, c.children]));
  if (typeof name === "string" && CHILDREN.includes(children as ComponentChildren)) {
    childrenOf.set(name, children as ComponentChildren);
  }

  for (const reference of shape.references) {
    const found = await resolve(reference.name);
    if (found && found.deletedAt === null) {
      childrenOf.set(reference.name, found.children);
      continue;
    }
    expandable = false;
    if (found) {
      problems.push(deletedProblem(reference.path, reference.name));
    } else {
      const match = ctx.catalog.find((c) => c.name.toLowerCase() === reference.name.toLowerCase());
      problems.push(
        `${reference.path}.component "${reference.name}" is not a catalog or custom component` +
          (match ? ` (did you mean ${match.name}?)` : ""),
      );
    }
  }

  const stripped = omitEmptyChildren(template, (n) => childrenOf.get(n));
  candidate.template = stripped as StoredCustomComponent["template"];

  if (expandable) {
    const expansion = await expandTree({ component: name, props: exampleProps }, { catalog: ctx.catalog, resolve });
    const errors = [...expansion.errors];
    if (expansion.tree) {
      const check = validateUiTree(expansion.tree, ctx.catalog, ctx.actions, undefined, {
        designChecks: false,
        maxNodes: MAX_EXPANDED_NODES,
        maxDepth: MAX_EXPANDED_DEPTH,
      });
      errors.push(...rewritePaths(check.errors, expansion.origins));
    }
    const root = `tree (${candidate.name} v${candidate.version}) template`;
    problems.push(...errors.map((error) => error.replaceAll(root, "template")));
  }

  if (problems.length > 0) return { ok: false, errors: limitErrors(problems) };
  return { ok: true, definition: { ...definition, template: stripped } as unknown as CustomComponentDefinition };
}
