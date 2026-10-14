import type { ComponentRepository } from "../../ports/ComponentRepository";
import type { ToolDefinition } from "../tools";
import { getComponentTool, listComponentsTool } from "./components";
import { renderUiTool } from "./ui";

/** Every tool the agent can call, built over the given ports. */
export function createAgentTools({
  components,
}: {
  components: ComponentRepository;
}): ToolDefinition[] {
  return [listComponentsTool(components), getComponentTool(components), renderUiTool(components)];
}
