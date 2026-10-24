import type { UiNode } from "./ui";

/** Longest prompt a generate request may carry. */
export const MAX_PROMPT_CHARS = 4000;

export interface GenerateRequest {
  prompt: string;
}

export interface GenerateSuccess {
  ok: true;
  id: string;
  tree: UiNode;
  /** What the person should know about the design, in everyday words; may be empty. */
  notes: string;
  /** Model calls made, repairs included. */
  attempts: number;
}

export interface GenerateFailure {
  ok: false;
  error: string;
  problems: string[];
  attempts: number;
}

export type GenerateResponse = GenerateSuccess | GenerateFailure;
