import type { UiNode } from "shared/ui";
import type { ActionRegistry, ActionSpec } from "../../actions/types";
import type { ComponentRepository } from "../../ports/ComponentRepository";
import { collectBindings } from "../../ui/bindings";
import { validateUiTree } from "../../ui/validateTree";
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

/**
 * Checks a UI tree against the catalog and the registered actions and, if it
 * is valid, shows it in the sandbox. With `listChoices`, also checks dropdowns
 * against the current values of their action's sources.
 */
export function renderUiTool(
  components: ComponentRepository,
  actions: ActionSpec[],
  listChoices?: ActionRegistry["listChoices"],
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
      const tree = args.tree;
      const catalog = await components.list();
      const choiceValues = listChoices && (await loadChoices(choiceSources(tree, actions), listChoices, ctx));
      const check = validateUiTree(tree, catalog, actions, choiceValues);
      if (!check.ok) {
        const n = check.errors.length;
        return {
          ok: false,
          summary: `UI has ${n} problem${n === 1 ? "" : "s"}`,
          data: { errors: check.errors },
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
