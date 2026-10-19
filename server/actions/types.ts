import type { ActionResult } from "shared/api";
import type { ToolLogger } from "../agent/tools";

/** What an action handler gets besides its values. */
export interface ActionContext {
  conversationId: string;
  /** The request's logger. */
  log: ToolLogger;
  /** Aborted when the request goes away; the registry also aborts it on timeout. */
  signal: AbortSignal;
}

/** An action's public description: what a Button may name and send. */
export interface ActionSpec {
  /** snake_case, unique within a registry. */
  name: string;
  /** What it does and which inputs it reads. */
  description: string;
  /**
   * JSON Schema for the values: `type: "object"`, `additionalProperties: false`,
   * and only string or boolean properties, each with a `description`.
   */
  input_schema: Record<string, unknown>;
}

/** An action a click can run: its spec plus the handler that runs it. */
export interface ActionDefinition extends ActionSpec {
  run(values: Record<string, string | boolean>, ctx: ActionContext): Promise<ActionResult>;
}

/** The actions a click may run, and how to run them. */
export interface ActionRegistry {
  specs: ActionSpec[];
  run(name: string, values: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult>;
}
