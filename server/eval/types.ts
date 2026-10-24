import type { CustomComponentDefinition } from "shared/customComponents";
import type { Generation } from "../generate/generate";

export type EvalCheck =
  | { maxAttempts: number }
  | { uiComponent: string }
  | { noUiComponent: string }
  | { uiButtonAction: string }
  | { noButtonAction: true }
  | { uiNamedInput: string }
  | { uiText: string }
  | { uiMarkupTag: string }
  | { agentComponent: string }
  | { notesMaxWords: number }
  | { notesExcludes: string };

export interface EvalCase {
  id: string;
  prompt: string;
  checks: EvalCheck[];
  /** Saved into the run's in-memory repository before the generation. */
  customComponents?: CustomComponentDefinition[];
}

export interface CheckFailure {
  /** Absent for a failure of the run itself, such as a generation that gave up. */
  check?: EvalCheck;
  reason: string;
}

export interface EvalCaseResult {
  id: string;
  ok: boolean;
  failures: CheckFailure[];
  generation?: Generation;
  error?: string;
}
