import type { ActionRegistry, ActionSpec } from "../../actions/types";
import type { ComponentRepository } from "../../ports/ComponentRepository";
import type { CustomComponentRepository } from "../../ports/CustomComponentRepository";
import type { ToolDefinition } from "../tools";
import { listActionsTool } from "./actions";
import { getComponentTool, listComponentsTool } from "./components";
import { renderUiTool } from "./ui";

/** Every tool the agent can call, built over the given ports and actions. */
export function createAgentTools({
  components,
  actions = [],
  listChoices,
  customComponents,
}: {
  components: ComponentRepository;
  /** What a Button may run; none by default. */
  actions?: ActionSpec[];
  /**
   * Dropdown values for the sources the actions name; without it list_actions
   * lists none and render_ui checks none.
   */
  listChoices?: ActionRegistry["listChoices"];
  /** Custom components render_ui expands; without it render_ui knows only the catalog. */
  customComponents?: CustomComponentRepository;
}): ToolDefinition[] {
  return [
    listComponentsTool(components),
    getComponentTool(components),
    listActionsTool(actions, listChoices),
    renderUiTool(components, actions, listChoices, customComponents),
  ];
}
