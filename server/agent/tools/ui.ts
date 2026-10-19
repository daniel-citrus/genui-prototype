import type { UiNode } from "shared/ui";
import type { ActionSpec } from "../../actions/types";
import type { ComponentRepository } from "../../ports/ComponentRepository";
import { validateUiTree } from "../../ui/validateTree";
import type { ToolDefinition } from "../tools";

/**
 * Checks a UI tree against the catalog and the registered actions and, if it
 * is valid, shows it in the sandbox.
 */
export function renderUiTool(components: ComponentRepository, actions: ActionSpec[]): ToolDefinition {
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
      const check = validateUiTree(tree, await components.list(), actions);
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
