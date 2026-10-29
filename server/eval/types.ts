import type { CustomComponentDefinition } from "shared/customComponents";
import type { Generation, GenerationAttempt } from "../generate/generate";

export type EvalCheck =
  | { maxAttempts: number }
  | { uiComponent: string }
  | { noUiComponent: string }
  | { uiButtonAction: string }
  | { noButtonAction: true }
  | { uiNamedInput: string }
  | { uiText: string }
  | { uiMarkupTag: string }
  /** A node of `component` whose props include each of `props`, compared as JSON. */
  | { uiProps: { component: string; props: Record<string, unknown> } }
  | { agentComponent: string }
  | { notesMaxWords: number }
  | { notesExcludes: string }
  /** The notes contain at least one of these, ignoring case. */
  | { notesMentions: string[] };

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
  /** The model calls completed before the generation rejected. */
  attempts?: GenerationAttempt[];
  error?: string;
}
