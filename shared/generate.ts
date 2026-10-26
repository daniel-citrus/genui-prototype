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

/** The tool a host agent offers its model so it can ask genui for a UI. */
export const GENERATE_UI_TOOL: { name: "generate_ui"; description: string; parameters: Record<string, unknown> } = {
  name: "generate_ui",
  description:
    "Call this when the person wants to see or use a form, list, card, chart or other UI. " +
    "In prompt, describe the UI and the data it shows. " +
    "Relay the notes in the result to the person.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        maxLength: MAX_PROMPT_CHARS,
        description: "What the UI should do and the data it shows.",
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
};
