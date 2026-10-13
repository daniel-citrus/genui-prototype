import type { ToolResult } from "shared/api";

/** A vendor-neutral tool definition; LLM adapters convert it to their format. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  input_schema: Record<string, unknown>;
}

/** The tools the agent may call, and how to run them. */
export interface ToolRegistry {
  specs: ToolSpec[];
  run(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

/** A registry with no tools: every call reports an unknown tool. */
export const emptyToolRegistry: ToolRegistry = {
  specs: [],
  run(name) {
    return Promise.resolve({ ok: false, summary: `Unknown tool: ${name}` });
  },
};
