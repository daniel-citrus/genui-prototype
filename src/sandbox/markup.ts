import { sanitizeMarkup, type MarkupElement } from "shared/markup";

/**
 * `root` with everything outside the shared allowlist left out, by the same
 * rules the server checks; null when the root itself is left out. Kept free
 * of DOM types so it can be tested without a DOM; `components.ts` draws it.
 * `kept` gets each element that stays with its path in the received root.
 */
export function filterMarkup(
  root: unknown,
  kept?: (element: MarkupElement, at: string) => void,
): MarkupElement | null {
  return sanitizeMarkup(root, "root", undefined, kept);
}
