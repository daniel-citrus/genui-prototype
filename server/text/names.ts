/**
 * Comparing menu names the way people type them. Copied from CapheVietPOS
 * `shared/domain/names.ts` at commit 60764e5. Names are stored as entered
 * (accents are part of the menu) and only folded for comparison.
 */

/** The stored form of a name: trimmed, in one Unicode form (NFC). */
export function cleanName(name: string): string {
  return name.normalize("NFC").trim();
}

/**
 * A name folded for comparison: accents dropped (including đ → d, which
 * Unicode doesn't decompose), lowercase, punctuation as spaces, single spaces.
 * "Cà phê Sữa Đá" and "ca phe sua da" both fold to "ca phe sua da".
 */
export function foldName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

/** "Ube Coffee (Large)", or just "Ube Coffee" for a single, unnamed size. */
export function sizeLabel(itemName: string, sizeName: string | undefined): string {
  return sizeName?.trim() ? `${itemName} (${sizeName})` : itemName;
}

/** "Topping: Trân châu". A colon, since group names often hold parentheses already. */
export function optionLabel(groupName: string, optionName: string): string {
  return `${groupName}: ${optionName}`;
}
