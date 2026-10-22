import type { EndedBy } from "../agent/trace";

export type EvalCheck =
  | { endedBy: EndedBy }
  | { noError: true }
  | { toolCalled: string }
  | { toolNotCalled: string }
  | { toolSucceeded: string }
  | { uiComponent: string }
  | { uiButtonAction: string }
  | { uiNamedInput: string };

export interface EvalCase {
  id: string;
  prompt: string;
  checks: EvalCheck[];
}

export interface CheckFailure {
  check: EvalCheck;
  reason: string;
}

export interface EvalCaseResult {
  id: string;
  ok: boolean;
  failures: CheckFailure[];
  endedBy?: EndedBy;
  error?: string;
}
