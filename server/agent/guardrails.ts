/**
 * Limits on one agent turn. The loop enforces the first three; the OpenAI
 * adapter enforces the last (it is the default for `AGENT_MAX_OUTPUT_TOKENS`).
 */

/** LLM completions allowed per turn. The last one is sent with tools off. */
export const MAX_STEPS = 10;

/** Tool calls the model may make in one turn; later ones are not run. */
export const MAX_TOOL_CALLS_PER_TURN = 20;

/** Prompt plus completion tokens, summed over a turn's completions. */
export const MAX_TURN_TOKENS = 150_000;

/** Output tokens allowed in a single completion. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

/** JSON with object keys sorted recursively, so equal values serialize equally. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Identifies a tool call by name and arguments, ignoring key order. */
export function callKey(name: string, args: Record<string, unknown>): string {
  return `${name}:${stableStringify(args)}`;
}
