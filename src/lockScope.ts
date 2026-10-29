import { nearestCard } from "shared/formScope";

/**
 * What a successful click on the button at `buttonPath` locks: its nearest
 * Card's path, or "tree" for the whole design. The whole design locks when
 * the button has no Card, or when `stale` (from the action's answer) names
 * any scope other than that Card.
 */
export function lockScope(tree: unknown, buttonPath: string, stale: string[] | undefined): string {
  const card = nearestCard(tree, buttonPath);
  if (card === undefined) return "tree";
  return (stale ?? []).every((scope) => scope === card) ? card : "tree";
}
