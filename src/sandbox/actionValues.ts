/** What the sandbox read from one named field of the shown design. */
export interface FieldReading {
  name: string;
  kind: "text" | "password" | "checkbox" | "select";
  value: string;
  checked: boolean;
}

/**
 * Turns the design's named fields into an action's `values`. Password fields
 * never leave the browser; a checkbox sends `checked`, everything else its
 * value (a select still on its placeholder sends `""`).
 */
export function actionValues(fields: FieldReading[]): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {};
  for (const field of fields) {
    if (field.kind === "password") continue;
    values[field.name] = field.kind === "checkbox" ? field.checked : field.value;
  }
  return values;
}
