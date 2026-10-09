// The weekly heads-up about payments that weren't logged. The database
// decides when one is due (claim_capture_summary); this only words it.
import type { PushMessage } from "./budget-alerts";

export interface CaptureSummary {
  missed: number;
  /** Paid with a card the household hasn't saved (e.g. an Afterpay card). */
  unknown_cards: number;
  /** Notifications the app couldn't read. */
  unreadable: number;
}

/** The Capture log reason for a capture from a card that isn't saved. */
export function unknownCardReason(card: string) {
  return `Not one of your cards: "${card.slice(0, 60)}". If it should count, add it (or name it as your phone does) in Settings → Accounts & cards.`;
}

export function captureSummaryMessage(s: CaptureSummary): PushMessage {
  const n = Number(s.missed);
  const cards = Number(s.unknown_cards);
  const unread = Number(s.unreadable);
  const one = n === 1;
  const body =
    cards && unread
      ? `${cards} on ${cards === 1 ? "a card" : "cards"} not saved in the app, ${unread} the app couldn't read.`
      : cards
        ? `${one ? "It was" : "They were"} on ${cards === 1 ? "a card" : "cards"} not saved in the app.`
        : `The app couldn't read ${one ? "it" : "them"}.`;
  return {
    title: one ? "1 payment wasn't logged last week" : `${n} payments weren't logged last week`,
    body: `${body} Tap to check the Capture log.`,
    url: "/settings/capture-log",
    tag: "capture-summary",
  };
}
