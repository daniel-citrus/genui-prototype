import type { ToolSpec } from "./tools";

/** Chat Completions function-tool shape, without importing the SDK here. */
export type OpenAIFunctionTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type StreamDelta = {
  content?: string | null;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
};

export type AccumulatedTurn = {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
};

export function toOpenAITools(specs: ToolSpec[]): OpenAIFunctionTool[] {
  return specs.map((spec) => ({
    type: "function",
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.input_schema,
    },
  }));
}

/** The arguments as a JSON object, or undefined when they are not a finished one. */
export function jsonObjectArguments(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON: fall through.
  }
  return undefined;
}

export function parseToolArguments(raw: string): Record<string, unknown> {
  return jsonObjectArguments(raw) ?? {};
}

/** Coalesces streamed Chat Completions deltas into one assistant turn. */
export function createTurnAccumulator(): {
  apply(delta: StreamDelta): void;
  finish(): AccumulatedTurn;
} {
  const toolAcc = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();
  let content = "";

  return {
    apply(delta) {
      if (delta.content) content += delta.content;
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const cur = toolAcc.get(idx) ?? { id: "", name: "", arguments: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
        toolAcc.set(idx, cur);
      }
    },
    finish() {
      return {
        content,
        toolCalls: [...toolAcc.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, value]) => value),
      };
    },
  };
}
