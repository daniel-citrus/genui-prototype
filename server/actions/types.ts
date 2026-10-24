import type { ActionResult } from "shared/api";
import type { Logger } from "../log";

/** What an action handler gets besides its values. */
export interface ActionContext {
  /** The design the click came from. */
  designId: string;
  /** The request's logger. */
  log: Logger;
  /** Aborted when the request goes away; the registry also aborts it on timeout. */
  signal: AbortSignal;
}

/** What an action does to its area. */
export const ACTION_OPERATIONS = ["create", "edit", "archive", "delete", "attach", "detach", "other"] as const;
export type ActionOperation = (typeof ACTION_OPERATIONS)[number];

/** Where a dropdown's values come from. Actions that share a source pass the same object. */
export interface ChoiceSource {
  /** snake_case, unique within a registry. */
  name: string;
  list(signal: AbortSignal): Promise<string[]>;
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
  /** What the action works on, e.g. "items"; snake_case. Missing counts as "other". */
  area?: string;
  /** What it does to it. Missing counts as "other". */
  operation?: ActionOperation;
  /** Input name → dropdown source name. */
  choices?: Record<string, string>;
  /** Asked before the action runs; `{input}` is replaced with that value. Present = needs confirmation. */
  confirm?: string;
}

/** An action a click can run: its spec plus the handler that runs it. */
export interface ActionDefinition extends Omit<ActionSpec, "choices"> {
  /** Input name → where its dropdown values come from. */
  choices?: Record<string, ChoiceSource>;
  run(values: Record<string, string | boolean>, ctx: ActionContext): Promise<ActionResult>;
}

/** The actions a click may run, and how to run them. */
export interface ActionRegistry {
  specs: ActionSpec[];
  run(name: string, values: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult>;
  /** Current values of a source named in `specs`; rejects for an unknown name. */
  listChoices(source: string, signal: AbortSignal): Promise<string[]>;
}
