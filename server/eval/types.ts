import type { CustomComponentDefinition } from "shared/customComponents";
import type { AgentTrace, EndedBy } from "../agent/trace";

export type EvalCheck =
  | { endedBy: EndedBy }
  | { noError: true }
  | { toolCalled: string }
  | { toolNotCalled: string }
  | { toolSucceeded: string }
  | { uiComponent: string }
  | { uiButtonAction: string }
  | { uiNamedInput: string }
  | { uiText: string }
  | { uiMarkupTag: string }
  | { agentComponent: string }
  | { noButtonAction: true }
  | { definedWithKey: string }
  | { noUiComponent: string }
  | { replyMaxWords: number }
  | { replyExcludes: string };

export interface EvalCase {
  id: string;
  prompt: string;
  checks: EvalCheck[];
  /** Saved into the run's in-memory repository before the turn. */
  customComponents?: CustomComponentDefinition[];
}

export interface CheckFailure {
  check: EvalCheck;
  reason: string;
}

export interface EvalCaseResult {
  id: string;
  ok: boolean;
  failures: CheckFailure[];
  trace: AgentTrace;
  endedBy?: EndedBy;
  error?: string;
}
