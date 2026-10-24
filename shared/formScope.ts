/**
 * Path of the nearest Card containing the node or Markup element at `path`
 * ("tree.children.0.props.root.children.1"), or undefined when none does.
 */
export function nearestCard(tree: unknown, path: string): string | undefined {
  const [, ...keys] = path.split(".");
  let current: unknown = tree;
  let at = "tree";
  let card: string | undefined;
  for (const key of keys) {
    if (typeof current !== "object" || current === null) return card;
    if ((current as { component?: unknown }).component === "Card") card = at;
    current = (current as Record<string, unknown>)[key];
    at += `.${key}`;
  }
  return card;
}

/** Whether the input at `inputPath` is sent by the action button at `buttonPath`. */
export function sendsInput(tree: unknown, buttonPath: string, inputPath: string): boolean {
  const card = nearestCard(tree, buttonPath);
  return card === undefined || inputPath.startsWith(`${card}.`);
}
