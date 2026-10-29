import { nearestCard } from "shared/formScope";

/**
 * What a successful click on the button at `buttonPath` locks: its nearest
 * Card's path, or "tree" for the whole design. The whole design locks when
 * the button has no Card, or when `stale` (from the action's answer) names
 * any scope other than that Card. A stale scope in or under a Card in
 * `locked` (the Cards earlier successes locked) can send nothing, so it
 * doesn't count.
 */
export function lockScope(
  tree: unknown,
  buttonPath: string,
  stale: string[] | undefined,
  locked: readonly string[] = [],
): string {
  const card = nearestCard(tree, buttonPath);
  if (card === undefined) return "tree";
  const isLocked = (scope: string) => locked.some((path) => scope === path || scope.startsWith(`${path}.`));
  return (stale ?? []).every((scope) => scope === card || isLocked(scope)) ? card : "tree";
}
