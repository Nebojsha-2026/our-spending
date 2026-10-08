// When the "buy me a coffee" card on the Overview shows (src/components/SupportCard.tsx).

export const SUPPORT_MIN_TRANSACTIONS = 50;
export const SUPPORT_SNOOZE_DAYS = 30;

/** What this phone remembers: supported for good, or snoozed until a time. */
export type SupportState = { supported?: boolean; snoozeUntil?: number };

export function shouldShowSupport(saved: SupportState, transactions: number, now = Date.now()) {
  if (saved.supported) return false;
  if (saved.snoozeUntil && saved.snoozeUntil > now) return false;
  return transactions >= SUPPORT_MIN_TRANSACTIONS;
}
