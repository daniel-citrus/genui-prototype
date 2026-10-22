import type { Component } from "shared/components";
import { MAX_EXPANDED_DEPTH, MAX_EXPANDED_NODES } from "shared/customComponents";
import type { UiNode } from "shared/ui";
import type { ActionRegistry, ActionSpec } from "../../actions/types";
import { expandTree, rewritePaths } from "../../customComponents/expand";
import type { ComponentRepository } from "../../ports/ComponentRepository";
import type { CustomComponentRepository } from "../../ports/CustomComponentRepository";
import { collectBindings, isObject } from "../../ui/bindings";
import { omitEmptyChildren } from "../../ui/omitEmptyChildren";
import { limitErrors, sizeProblems, type UiTreeCheck, type UiTreeOptions, validateUiTree } from "../../ui/validateTree";
import type { ToolContext, ToolDefinition } from "../tools";

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
  ctx: ToolContext,
): Promise<Record<string, string[]>> {
  const values: Record<string, string[]> = {};
  await Promise.all(
    [...sources].map(async (source) => {
      try {
        values[source] = await listChoices(source, ctx.signal);
      } catch (err) {
        ctx.log.error({ source, err }, "loading dropdown values failed");
      }
    }),
  );
  return values;
}

/** What render_ui checks and shows. */
interface Design {
  /** null when the root was refused while expanding. */
  tree: unknown;
  /** Found before validating `tree`, in the agent's terms. */
  problems: string[];
  /** Rewrites validator paths into the agent's (see `rewritePaths`). */
  origins: Map<string, string>;
  options: UiTreeOptions;
}

/**
 * Problems with the agent's own tree that expanding it would hide: Markup
 * nodes, which belong in templates, and the size limits, with a custom node
 * counting as one.
 */
function ownTreeProblems(tree: unknown): string[] {
  const markup: string[] = [];
  const stats = { nodes: 0, depth: 0 };
  const visit = (node: unknown, path: string, level: number): void => {
    if (!isObject(node)) return;
    stats.nodes += 1;
    stats.depth = Math.max(stats.depth, level);
    if (node.component === "Markup") {
      markup.push(`${path} Markup can only be used inside a custom component; define one with define_component`);
    }
    if (!Array.isArray(node.children)) return;
    node.children.forEach((child, i) => visit(child, `${path}.children.${i}`, level + 1));
  };
  visit(tree, "tree", 1);
  return [...sizeProblems(stats), ...markup];
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
 * Checks a UI tree against the catalog and the registered actions and, if it
 * is valid, shows it in the sandbox. With `listChoices`, also checks dropdowns
 * against the current values of their action's sources. With
 * `customComponents`, first expands the custom components in the tree (see
 * `expandTree`) and checks and shows the expanded tree; Markup is refused
 * outside their templates.
 */
export function renderUiTool(
  components: ComponentRepository,
  actions: ActionSpec[],
  listChoices?: ActionRegistry["listChoices"],
  customComponents?: CustomComponentRepository,
): ToolDefinition {
  return {
    name: "render_ui",
    description:
      "Check a UI tree against the catalog and show it in the sandbox. Send the whole tree every time, including for small edits. If it reports problems, nothing is shown: fix them and call it again.",
    input_schema: {
      type: "object",
      properties: {
        tree: {
          type: "object",
          description: "The whole UI tree: { component, props, children }.",
        },
      },
      required: ["tree"],
      additionalProperties: false,
    },
    async run(args, ctx) {
      const catalog = await components.list();
      let design: Design = { tree: args.tree, problems: [], origins: new Map(), options: {} };
      if (customComponents) {
        try {
          design = await expandDesign(args.tree, catalog, customComponents);
        } catch (err) {
          ctx.log.error({ err }, "loading custom components failed");
          return { ok: false, summary: "Custom components are unavailable" };
        }
      }
      const tree = omitEmptyChildren(design.tree, (name) => catalog.find((c) => c.name === name)?.children);
      let check: UiTreeCheck | undefined;
      if (tree !== null) {
        const choiceValues = listChoices && (await loadChoices(choiceSources(tree, actions), listChoices, ctx));
        check = validateUiTree(tree, catalog, actions, choiceValues, design.options);
      }
      const errors = limitErrors([...design.problems, ...rewritePaths(check?.errors ?? [], design.origins)]);
      if (!check || errors.length > 0) {
        const n = errors.length;
        return {
          ok: false,
          summary: `UI has ${n} problem${n === 1 ? "" : "s"}`,
          data: { errors },
        };
      }
      ctx.showUi(tree as UiNode);
      return {
        ok: true,
        summary: `Rendered ${check.stats.nodes} components`,
        data: { stats: check.stats },
      };
    },
  };
}
