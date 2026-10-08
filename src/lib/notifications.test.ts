import { describe, expect, it } from "vitest";
import { looksLikeCard, parseNotification, readIngestBody } from "./notifications";

const purchase = (raw: string, app: string) => parseNotification(raw, app);

describe("parseNotification", () => {
  it("reads Google Wallet notifications (title = merchant)", () => {
    expect(purchase("Woolworths | $23.50 with Visa ••1234", "Google Wallet")).toEqual({
      kind: "purchase", cents: 2350, merchant: "Woolworths", card: "Visa 1234",
    });
    expect(purchase("Coles Ryde | A$38.50 with ANZ Visa •••• 4821", "Wallet")).toEqual({
      kind: "purchase", cents: 3850, merchant: "Coles Ryde", card: "ANZ Visa 4821",
    });
    // No title separator configured.
    expect(purchase("Guzman y Gomez $27.90 with Mastercard ••9999", "Wallet")).toMatchObject({
      merchant: "Guzman y Gomez", cents: 2790, card: "Mastercard 9999",
    });
    expect(purchase("Google Wallet | Paid $4.80 to Opal", "Google Wallet")).toMatchObject({ merchant: "Opal", cents: 480 });
  });

  it("reads bank-app purchase alerts", () => {
    expect(purchase("ANZ | A purchase of $23.50 was made at WOOLWORTHS 1234 NEWTOWN on your card ending 1234.", "ANZ Plus")).toEqual({
      kind: "purchase", cents: 2350, merchant: "WOOLWORTHS 1234 NEWTOWN", card: "1234",
    });
    expect(purchase("Card purchase | You spent $12.40 at KAFE 88 SYDNEY using card ending in 4821", "NAB")).toEqual({
      kind: "purchase", cents: 1240, merchant: "KAFE 88 SYDNEY", card: "4821",
    });
    expect(purchase("NAB | $1,204.00 spent at FLIGHT CENTRE PARRAMATTA", "NAB")).toMatchObject({ cents: 120400, merchant: "FLIGHT CENTRE PARRAMATTA" });
    // Merchant after the amount, no "at".
    expect(purchase("NAB | Tap & go: $6.50 Ryde Bakehouse", "NAB")).toMatchObject({ cents: 650, merchant: "Ryde Bakehouse" });
    expect(purchase("ANZ | $18.99 - NETFLIX.COM on card ending 1234", "ANZ")).toMatchObject({ merchant: "NETFLIX.COM", card: "1234" });
  });

  it("ignores things that aren't purchases", () => {
    expect(purchase("ANZ | Your card was declined at KMART for $46.00", "ANZ")).toEqual({ kind: "ignored", reason: "declined" });
    expect(purchase("NAB | You received $50.00 from J SMITH", "NAB")).toEqual({ kind: "ignored", reason: "money in" });
    expect(purchase("ANZ | Refund of $29.99 from AMAZON", "ANZ")).toEqual({ kind: "ignored", reason: "refund or credit" });
    expect(purchase("NAB | Your balance is $1,000.00", "NAB")).toEqual({ kind: "ignored", reason: "account alert" });
    expect(purchase("ANZ | $200.00 transferred to Savings", "ANZ")).toEqual({ kind: "ignored", reason: "transfer" });
  });

  it("reports what it couldn't read", () => {
    expect(purchase("ANZ | Something happened", "ANZ")).toEqual({ kind: "unparsed", reason: "no amount found" });
    expect(purchase("ANZ | $12.00 spent", "ANZ")).toEqual({ kind: "purchase", cents: 1200, merchant: null, card: null });
    expect(purchase("ANZ | Reminder: $12.00", "ANZ")).toEqual({ kind: "unparsed", reason: "no merchant found" });
    expect(purchase("   ", "ANZ")).toEqual({ kind: "unparsed", reason: "empty notification" });
  });
});

describe("readIngestBody", () => {
  it("reads normal JSON", () => {
    expect(readIngestBody('{"raw":"a | b","app":"NAB","source":"android"}', "application/json")).toEqual({
      raw: "a | b", app: "NAB", source: "android",
    });
  });

  it("survives quotes and line breaks MacroDroid pastes into the template", () => {
    const body = '{"raw": "Joe\'s "Cafe" | $5.00 with Visa ••1234\nThanks", "app": "Google Wallet", "source": "android"}';
    expect(readIngestBody(body, "application/json")).toEqual({
      raw: 'Joe\'s "Cafe" | $5.00 with Visa ••1234\nThanks', app: "Google Wallet", source: "android",
    });
  });

  it("reads form posts and rejects junk", () => {
    expect(readIngestBody("raw=Woolworths+%7C+%2423.50&app=Wallet", "application/x-www-form-urlencoded")).toEqual({
      raw: "Woolworths | $23.50", app: "Wallet",
    });
    expect(readIngestBody("hello", "text/plain")).toBeNull();
    expect(readIngestBody("", "application/json")).toBeNull();
  });
});

describe("Google Wallet notifications titled with the card", () => {
  it("never saves the card as the shop", () => {
    expect(purchase("Visa | $2.50", "Google Wallet")).toEqual({ kind: "purchase", cents: 250, merchant: null, card: "Visa" });
    expect(purchase("Visa ••1234 | $23.50", "Google Wallet")).toEqual({ kind: "purchase", cents: 2350, merchant: null, card: "Visa 1234" });
    expect(purchase("Visa | $23.50 with Visa ••1234", "Google Wallet")).toMatchObject({ merchant: null, card: "Visa 1234" });
    expect(purchase("ANZ Visa Debit •••• 4821 | $9.00", "Wallet")).toMatchObject({ merchant: null, card: "ANZ Visa Debit 4821" });
  });

  it("finds the shop in the text when the title is the card", () => {
    expect(purchase("Visa ••1234 | $23.50 at Woolworths", "Google Wallet")).toMatchObject({ merchant: "Woolworths", card: "Visa 1234" });
    expect(purchase("Visa | Woolworths · $23.50", "Google Wallet")).toMatchObject({ merchant: "Woolworths" });
    expect(purchase("Mastercard ••9999 | $23.50 · Woolworths Newtown", "Google Wallet")).toMatchObject({ merchant: "Woolworths Newtown" });
  });

  it("still uses a real shop title", () => {
    expect(purchase("Woolworths | $23.50 with Visa ••1234", "Google Wallet")).toMatchObject({ merchant: "Woolworths", card: "Visa 1234" });
    expect(purchase("Credit Union Cafe | $4.00 with Visa ••1234", "Google Wallet")).toMatchObject({ merchant: "Credit Union Cafe" });
  });
});

describe("looksLikeCard", () => {
  it("knows cards from shops", () => {
    for (const card of ["Visa", "VISA", "Visa ••1234", "Mastercard •••• 9999", "ANZ Visa Debit", "NAB Rewards Platinum Card ending 4821", "Debit card"]) {
      expect(looksLikeCard(card), card).toBe(true);
    }
    for (const shop of ["Woolworths", "Credit Union Cafe", "Card Shop", "Gold Coast Bakery", "ANZ Stadium", "Visa Bar & Grill"]) {
      expect(looksLikeCard(shop), shop).toBe(false);
    }
  });
});

describe("labelled notification titles", () => {
  it("reads 'From: VISA' as the card, not the shop", () => {
    expect(purchase("From: VISA | $6.01 with Visa ••6800", "Google Wallet")).toEqual({ kind: "purchase", cents: 601, merchant: null, card: "Visa 6800" });
    expect(purchase("From: VISA | $6.01", "Wallet")).toMatchObject({ merchant: null, card: "VISA" });
    expect(purchase("From: VISA ••6800 | $6.01 at Woolworths", "Google Wallet")).toMatchObject({ merchant: "Woolworths" });
  });

  it("keeps a labelled shop name, without the label", () => {
    expect(purchase("Merchant: KFC Newtown | $12.50 with Visa ••6800", "Google Wallet")).toMatchObject({ merchant: "KFC Newtown" });
  });
});

