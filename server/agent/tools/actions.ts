import type { ActionSpec } from "../../actions/types";
import type { ToolDefinition } from "../tools";

/** Lists the actions a Button may run, with the values each reads. */
export function listActionsTool(actions: ActionSpec[]): ToolDefinition {
  return {
    name: "list_actions",
    description:
      "List the backend actions a Button can run when clicked: each one's name, what it does, and the input values it reads (input_schema). Call this when a button in the design should do something.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    async run() {
      return {
        ok: true,
        summary: `Listed ${actions.length} actions`,
        data: {
          actions: actions.map(({ name, description, input_schema }) => ({
            name,
            description,
            input_schema,
          })),
        },
      };
    },
  };
}
