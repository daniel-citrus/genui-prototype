import type { Money } from "../../ports/PosMenu";

/**
 * A typed price ("4", "4.5", "4.50", "$4.50") as USD cents, or null when it
 * doesn't look like one. CapheVietPOS's `parseMoney` (`shared/domain/money.ts`
 * at commit 60764e5), also refusing amounts too large to count exactly.
 */
export function parsePrice(text: string): Money | null {
  const trimmed = text.trim().replace(/[$,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const amount = Math.round(parseFloat(trimmed) * 100);
  return Number.isSafeInteger(amount) ? { amount, currency: "USD" } : null;
}

/** "$4.50", as CapheVietPOS's `formatMoney` writes it. */
export function formatPrice(money: Money): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: money.currency }).format(
    money.amount / 100,
  );
}
