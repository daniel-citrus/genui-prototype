import type { ActionRegistry, ActionSpec } from "../../actions/types";
import {
  checkDesign,
  CustomComponentsUnavailableError,
} from "../../generate/checkDesign";
import type { ComponentRepository } from "../../ports/ComponentRepository";
import type { CustomComponentRepository } from "../../ports/CustomComponentRepository";
import type { ToolDefinition } from "../tools";

/**
 * Checks a UI tree with `checkDesign` and, if it is valid, shows it in the sandbox.
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
      const deps = {
        catalog: await components.list(),
        actions,
        listChoices,
        customComponents,
        log: ctx.log,
        signal: ctx.signal,
      };
      let check;
      try {
        check = await checkDesign(args.tree, deps);
      } catch (err) {
        if (err instanceof CustomComponentsUnavailableError)
          return { ok: false, summary: err.message };
        throw err;
      }
      if (!check.ok) {
        const n = check.problems.length;
        return {
          ok: false,
          summary: `UI has ${n} problem${n === 1 ? "" : "s"}`,
          data: { errors: check.problems },
          retryable: true,
        };
      }
      ctx.showUi(check.tree);
      return {
        ok: true,
        summary: `Rendered ${check.stats.nodes} components`,
        data: { stats: check.stats },
      };
    },
  };
}
