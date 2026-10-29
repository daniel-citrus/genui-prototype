import { sendsInput } from "shared/formScope";
import type { ActionSpec } from "../actions/types";
import { collectBindings, type NamedInput } from "./bindings";

/**
 * The scopes of `tree` holding a dropdown that can now send a value its source
 * no longer offers: each such Select's nearest Card path, or "tree" outside
 * every Card, once each in document order. A Select is bound to a source when
 * an enabled button that sends it runs an action whose `choices` name it.
 * `list` gives a source's current values and is called once per bound source;
 * when it fails, every scope bound to that source is stale.
 */
export async function staleScopes(
  tree: unknown,
  specs: ActionSpec[],
  list: (source: string) => Promise<string[]>,
): Promise<string[]> {
  const { inputs, buttons } = collectBindings(tree);
  const choicesByAction = new Map(specs.map((spec) => [spec.name, spec.choices ?? {}]));
  const enabled = buttons.filter((b) => !b.disabled);

  const bound: { input: NamedInput; source: string }[] = [];
  for (const input of inputs) {
    if (input.component !== "Select") continue;
    for (const button of enabled) {
      const source = choicesByAction.get(button.action)?.[input.name];
      if (source && sendsInput(tree, button.path, input.path)) bound.push({ input, source });
    }
  }

  const current = new Map<string, string[]>();
  await Promise.all(
    [...new Set(bound.map((b) => b.source))].map(async (source) => {
      try {
        current.set(source, await list(source));
      } catch {
        // Left out: every scope bound to it counts as stale.
      }
    }),
  );

  const stale = new Set<string>();
  for (const { input, source } of bound) {
    const values = current.get(source);
    if (!values || sendable(input).some((value) => !values.includes(value))) stale.add(input.card ?? "tree");
  }
  return [...stale];
}

/**
 * The non-empty values a Select can send: only its preset when it is disabled
 * and has one, otherwise (Markup `select` included) any of its options.
 */
function sendable(input: NamedInput): string[] {
  const values = input.disabled && input.value !== undefined ? [input.value] : (input.options ?? []);
  return values.filter((value) => value !== "");
}
