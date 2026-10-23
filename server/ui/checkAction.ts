import { MAX_FIELD_CHARS } from "shared/api";
import { sendsInput } from "shared/formScope";
import type { UiNode } from "shared/ui";
import { collectBindings, type NamedInput } from "./bindings";

export type ActionRequestCheck = { ok: true } | { ok: false; message: string };

/**
 * Whether a click on `design` may run `action` with `values`: the action must
 * be on a Button that isn't disabled, and every value must belong to a named
 * input that button sends (everything inside its nearest Card, or the whole
 * design when it has none) and fit it. Each enabled button for the action is
 * tried in document order; the first whose scope takes every value wins,
 * otherwise the first scope's refusal is returned. Messages name inputs,
 * never values.
 *
 * Several inputs in a scope may share a name; a value is accepted when it fits
 * any of them, and refused outright when one of them is a password field.
 */
export function checkActionRequest(
  tree: UiNode,
  action: string,
  values: Record<string, string | boolean>,
): ActionRequestCheck {
  const { inputs, buttons } = collectBindings(tree);
  const candidates = buttons.filter((b) => b.action === action && !b.disabled);

  if (candidates.length === 0) {
    return { ok: false, message: `This design has no enabled button for action "${action}".` };
  }

  let firstRefusal: ActionRequestCheck | undefined;
  for (const button of candidates) {
    const scope = inputs.filter((input) => sendsInput(tree, button.path, input.path));
    const check = checkScope(scope, values, button.card ? action : undefined);
    if (check.ok) return check;
    firstRefusal ??= check;
  }
  return firstRefusal!;
}

/** `scoped` is the action name when the inputs come from a Card. */
function checkScope(
  inputs: NamedInput[],
  values: Record<string, string | boolean>,
  scoped: string | undefined,
): ActionRequestCheck {
  const byName = new Map<string, NamedInput[]>();
  for (const input of inputs) byName.set(input.name, [...(byName.get(input.name) ?? []), input]);

  for (const [name, value] of Object.entries(values)) {
    const named = byName.get(name);
    if (!named) {
      const where = scoped ? ` next to a "${scoped}" button` : "";
      return { ok: false, message: `This design has no input named "${name}"${where}.` };
    }
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
