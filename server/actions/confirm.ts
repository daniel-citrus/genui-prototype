/** A `{property}` in a confirm question; the group is the property name. */
export const CONFIRM_PLACEHOLDER = /\{([^{}]*)\}/g;

/**
 * The confirm question with each `{property}` replaced by that value as text,
 * or `(none)` when the value is `""` or missing.
 */
export function fillConfirm(question: string, values: Record<string, string | boolean>): string {
  return question.replace(CONFIRM_PLACEHOLDER, (_match, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : "";
    return value === "" ? "(none)" : String(value);
  });
}
