import type { ToolResult } from "shared/api";
import type { UiNode } from "shared/ui";
import type { Logger } from "../log";
import { createToolRegistry } from "./registry";

/** A vendor-neutral tool definition; LLM adapters convert it to their format. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  input_schema: Record<string, unknown>;
}

/** The logger tools use. */
export type ToolLogger = Logger;

/** What a tool handler gets besides its arguments. */
export interface ToolContext {
  /** Aborted when the user presses Stop. */
  signal: AbortSignal;
  /** The request's logger. */
  log: ToolLogger;
  /** Show a checked UI tree in the browser's sandbox (a `ui` event). */
  showUi(tree: UiNode): void;
}

/** A tool the agent can call: its spec plus the handler that runs it. */
export interface ToolDefinition {
  /** snake_case, unique within a registry. */
  name: string;
  /** What it does and when to use it. */
  description: string;
  /** JSON Schema for the arguments: `type: "object"`, `additionalProperties: false`. */
  input_schema: Record<string, unknown>;
  /** Set on tools that change stored state; a successful call lets earlier identical calls run again. */
  writes?: true;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/** The tools the agent may call, and how to run them. */
export interface ToolRegistry {
  specs: ToolSpec[];
  /** Whether the named tool changes stored state. False for unknown names. */
  writes(name: string): boolean;
  run(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/** A registry with no tools: every call reports an unknown tool. */
export const emptyToolRegistry: ToolRegistry = createToolRegistry([]);
