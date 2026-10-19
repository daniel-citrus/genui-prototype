import type { ActionSpec } from "../../actions/types";
import type { ComponentRepository } from "../../ports/ComponentRepository";
import type { ToolDefinition } from "../tools";
import { listActionsTool } from "./actions";
import { getComponentTool, listComponentsTool } from "./components";
import { renderUiTool } from "./ui";

/** Every tool the agent can call, built over the given ports and actions. */
export function createAgentTools({
  components,
  actions = [],
}: {
  components: ComponentRepository;
  /** What a Button may run; none by default. */
  actions?: ActionSpec[];
}): ToolDefinition[] {
  return [
    listComponentsTool(components),
    getComponentTool(components),
    listActionsTool(actions),
    renderUiTool(components, actions),
  ];
}
