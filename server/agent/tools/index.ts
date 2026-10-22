import type { ActionRegistry, ActionSpec } from "../../actions/types";
import type { ComponentRepository } from "../../ports/ComponentRepository";
import type { CustomComponentRepository } from "../../ports/CustomComponentRepository";
import type { ToolDefinition } from "../tools";
import { listActionsTool } from "./actions";
import { getComponentTool, listComponentsTool } from "./components";
import { defineComponentTool, deleteComponentTool } from "./customComponents";
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
  /**
   * Custom components the agent can list, read, define, delete and render;
   * without it the tools know only the catalog, and there is no
   * define_component or delete_component.
   */
  customComponents?: CustomComponentRepository;
}): ToolDefinition[] {
  return [
    listComponentsTool(components, customComponents),
    getComponentTool(components, customComponents),
    listActionsTool(actions, listChoices),
    renderUiTool(components, actions, listChoices, customComponents),
    ...(customComponents
      ? [defineComponentTool(components, customComponents, actions), deleteComponentTool(components, customComponents)]
      : []),
  ];
}
