import type { Component } from "shared/components";
import {
  MAX_EXPANDED_DEPTH,
  MAX_EXPANDED_NODES,
} from "shared/customComponents";
import type { UiNode } from "shared/ui";
import type { ActionRegistry, ActionSpec } from "../actions/types";
import { expandTree, rewritePaths } from "../customComponents/expand";
import type { Logger } from "../log";
import type { CustomComponentRepository } from "../ports/CustomComponentRepository";
import { collectBindings, isObject } from "../ui/bindings";
import { omitEmptyChildren } from "../ui/omitEmptyChildren";
import { tidyDesign } from "./tidyDesign";
import {
  limitErrors,
  MAX_NODES,
  sizeProblems,
  type UiTreeCheck,
  type UiTreeOptions,
  type UiTreeStats,
  validateUiTree,
} from "../ui/validateTree";

/** The custom component repository failed while checking a design. */
export class CustomComponentsUnavailableError extends Error {}

export interface DesignCheckDeps {
  catalog: Component[];
  actions: ActionSpec[];
  /** With it, dropdowns are checked against the current values of their action's sources. */
  listChoices?: ActionRegistry["listChoices"];
  /** With it, custom components in the design are expanded first; Markup controls are refused outside their templates. */
  customComponents?: CustomComponentRepository;
  log: Logger;
  signal: AbortSignal;
}

export type DesignCheck =
  | { ok: true; tree: UiNode; stats: UiTreeStats }
  | { ok: false; problems: string[] };

/** The dropdown sources of the inputs in `tree` that fill a property of an action some Button names. */
function choiceSources(tree: unknown, actions: ActionSpec[]): Set<string> {
  const { inputs, buttons } = collectBindings(tree);
  const named = new Set(buttons.map((b) => b.action));
  const sources = new Set<string>();
  for (const spec of actions) {
    if (!named.has(spec.name) || !spec.choices) continue;
    for (const input of inputs) {
      const source = spec.choices[input.name];
      if (source) sources.add(source);
    }
  }
  return sources;
}

/** Current values of each source, by name; a source that fails is logged and left out. */
async function loadChoices(
  sources: Set<string>,
  listChoices: ActionRegistry["listChoices"],
  log: Logger,
  signal: AbortSignal,
): Promise<Record<string, string[]>> {
  const values: Record<string, string[]> = {};
  await Promise.all(
    [...sources].map(async (source) => {
      try {
        values[source] = await listChoices(source, signal);
      } catch (err) {
        log.error({ source, err }, "loading dropdown values failed");
      }
    }),
  );
  return values;
}

/** What checkDesign checks. */
interface Design {
  /** null when the root was refused while expanding. */
  tree: unknown;
  /** Found before validating `tree`, in the designer's terms. */
  problems: string[];
  /** Rewrites validator paths into the design's (see `rewritePaths`). */
  origins: Map<string, string>;
  options: UiTreeOptions;
}

const FORM_TAGS = new Set(["input", "select", "button"]);

/** The form-control tags in a Markup element and its descendants, in order. */
function markupControls(element: unknown): string[] {
  if (!isObject(element)) return [];
  const own =
    typeof element.tag === "string" && FORM_TAGS.has(element.tag)
      ? [element.tag]
      : [];
  const children = Array.isArray(element.children) ? element.children : [];
  return [...own, ...children.flatMap(markupControls)];
}

/**
 * Problems with the design's own tree that expanding it would hide: Markup
 * form controls, which designs build from catalog components, and the size
 * limits, with a custom node counting as one.
 */
function ownTreeProblems(tree: unknown): string[] {
  const controls: string[] = [];
  const stats = { nodes: 0, depth: 0 };
  const visit = (node: unknown, path: string, level: number): void => {
    if (!isObject(node)) return;
    stats.nodes += 1;
    stats.depth = Math.max(stats.depth, level);
    if (node.component === "Markup" && isObject(node.props)) {
      for (const tag of new Set(markupControls(node.props.root))) {
        controls.push(
          `${path} Markup ${tag} can't be used directly in a design; use TextInput, Checkbox, Select or Button, or put it in a custom component template`,
        );
      }
    }
    if (!Array.isArray(node.children)) return;
    node.children.forEach((child, i) =>
      visit(child, `${path}.children.${i}`, level + 1),
    );
  };
  visit(tree, "tree", 1);
  const tooMany =
    stats.nodes > MAX_NODES
      ? [
          `tree has ${stats.nodes} nodes (max ${MAX_NODES}); simplify the design or reuse a listed custom component, where each use counts as one node`,
        ]
      : [];
  return [...sizeProblems(stats, Infinity), ...tooMany, ...controls];
}

/**
 * `tree` with its custom components expanded, to be validated under the
 * expanded limits. Asks `customComponents` only about names that aren't in
 * the catalog, and suggests custom names for the ones it doesn't know.
 */
async function expandDesign(
  tree: unknown,
  catalog: Component[],
  customComponents: CustomComponentRepository,
): Promise<Design> {
  const unknown: string[] = [];
  const expansion = await expandTree(tree, {
    catalog,
    resolve: async (name) => {
      const found = await customComponents.getByName(name);
      if (!found) unknown.push(name);
      return found;
    },
  });
  // A case-insensitive catalog match is suggested by the validator already.
  const suggestions = await Promise.all(
    unknown
      .map((name) => name.toLowerCase())
      .filter((lower) => !catalog.some((c) => c.name.toLowerCase() === lower))
      .map(async (lower) => {
        const { components } = await customComponents.list({ search: lower });
        return components.find((c) => c.name.toLowerCase() === lower)?.name;
      }),
  );
  return {
    tree: expansion.tree,
    problems: [...ownTreeProblems(tree), ...expansion.errors],
    origins: expansion.origins,
    options: {
      maxNodes: MAX_EXPANDED_NODES,
      maxDepth: MAX_EXPANDED_DEPTH,
      suggestions: suggestions.filter((name) => name !== undefined),
    },
  };
}

/**
 * Checks a UI tree against the catalog and the registered actions, after
 * `tidyDesign` fixes its harmless slips. When it is valid, returns the
 * checked tree (custom components expanded, empty children arrays dropped)
 * and its stats; otherwise at most 20 problems. Rejects with
 * `CustomComponentsUnavailableError` when the custom component repository
 * fails.
 */
export async function checkDesign(
  untidy: unknown,
  deps: DesignCheckDeps,
): Promise<DesignCheck> {
  const { catalog, actions, listChoices, customComponents, log, signal } = deps;
  const tree = tidyDesign(untidy);
  let design: Design = { tree, problems: [], origins: new Map(), options: {} };
  if (customComponents) {
    try {
      design = await expandDesign(tree, catalog, customComponents);
    } catch (err) {
      log.error({ err }, "loading custom components failed");
      throw new CustomComponentsUnavailableError(
        "Custom components are unavailable",
        { cause: err },
      );
    }
  }
  const expanded = omitEmptyChildren(
    design.tree,
    (name) => catalog.find((c) => c.name === name)?.children,
  );
  let check: UiTreeCheck | undefined;
  if (expanded !== null) {
    const choiceValues =
      listChoices &&
      (await loadChoices(
        choiceSources(expanded, actions),
        listChoices,
        log,
        signal,
      ));
    check = validateUiTree(
      expanded,
      catalog,
      actions,
      choiceValues,
      design.options,
    );
  }
  const problems = limitErrors([
    ...design.problems,
    ...rewritePaths(check?.errors ?? [], design.origins),
  ]);
  if (!check || problems.length > 0) return { ok: false, problems };
  return { ok: true, tree: expanded as UiNode, stats: check.stats };
}
