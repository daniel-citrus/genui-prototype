/** Tabs logic kept free of DOM types so it can be tested without a browser. */

/** Up to this many labels draw a tab bar; more draw a "Show" dropdown. */
export const MAX_TAB_BAR_LABELS = 4;

export type TabsMode = "bar" | "select";

export function tabsMode(labelCount: number): TabsMode {
  return labelCount <= MAX_TAB_BAR_LABELS ? "bar" : "select";
}

/**
 * The tab a key moves to from tab `current` of `count`: Left and Right wrap
 * at the ends, Home and End go to the first and last. Undefined for any other key.
 */
export function tabForKey(key: string, current: number, count: number): number | undefined {
  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}

/**
 * Pairs each label with the child in the same place. A child without a
 * non-empty string label is left out; a label without a child has no `panel`.
 */
export function tabPanels<T>(labels: unknown, children: readonly T[]): Array<{ label: string; panel?: T }> {
  if (!Array.isArray(labels)) return [];
  return labels.flatMap((label, i) =>
    typeof label === "string" && label !== "" ? [{ label, panel: children[i] }] : [],
  );
}
