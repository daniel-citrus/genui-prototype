import { MAX_FIELD_CHARS } from "shared/api";
import type { UiNode } from "shared/ui";
import { collectBindings, type NamedInput } from "./bindings";

export type ActionRequestCheck = { ok: true } | { ok: false; message: string };

/**
 * Whether a click on `design` may run `action` with `values`: the action must
 * be on a Button that isn't disabled, and every value must belong to a named
 * input of that design and fit it. Messages name inputs, never values.
 *
 * Several inputs may share a name; a value is accepted when it fits any of
 * them, and refused outright when one of them is a password field.
 */
export function checkActionRequest(
  tree: UiNode,
  action: string,
  values: Record<string, string | boolean>,
): ActionRequestCheck {
  const { inputs, buttons } = collectBindings(tree);

  if (!buttons.some((b) => b.action === action && !b.disabled)) {
    return { ok: false, message: `This design has no enabled button for action "${action}".` };
  }

  const byName = new Map<string, NamedInput[]>();
  for (const input of inputs) byName.set(input.name, [...(byName.get(input.name) ?? []), input]);

  for (const [name, value] of Object.entries(values)) {
    const named = byName.get(name);
    if (!named) return { ok: false, message: `This design has no input named "${name}".` };
    if (named.some((input) => input.component === "TextInput" && input.type === "password")) {
      return { ok: false, message: `"${name}" is a password field; its value is never sent.` };
    }
    if (!named.some((input) => fits(input, value))) {
      return { ok: false, message: `The value for "${name}" doesn't fit its input.` };
    }
  }
  return { ok: true };
}

function fits(input: NamedInput, value: string | boolean): boolean {
  switch (input.component) {
    case "TextInput":
      return typeof value === "string" && value.length <= MAX_FIELD_CHARS;
    case "Checkbox":
      return typeof value === "boolean";
    case "Select":
      return value === "" || (typeof value === "string" && (input.options ?? []).includes(value));
  }
}
