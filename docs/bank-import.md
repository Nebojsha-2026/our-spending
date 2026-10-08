# Bank CSV import, Needs review and rules

Phone capture misses physical-card swipes, online card-number payments and direct debits; a monthly CSV fills the gaps and confirms what the phones caught.

1. In your internet banking (ANZ, NAB, CBA, Westpac…), open the card or account and export transactions as **CSV** for the period (overlapping a previous import is fine).
2. In the app: *Settings → Import bank CSV*, pick the card the file belongs to, choose the file.
3. Check the preview, tap rows to include or exclude them, then **Import**.

What happens to each row:
- **Confirms an earlier entry**: exactly one phone capture on that card (or, failing that, on any of the same person's cards) has the same amount within 3 days. It is merged: the phone's time and person stay, the bank's description is added, and it becomes *confirmed*. A **manual entry** (same person, amount, within 3 days) merges the same way when its name is the same shop ("Hungry Jack's" vs `HUNGRY JACKS 1234`).
- **Possible duplicate**: several phone captures could match, or a manual entry with a different name does (a cash coffee typed in by hand is never swallowed by a card purchase of the same amount). It is imported but flagged in *Activity → Needs review* (never merged silently); there, **Merge** it into the earlier entry, **Keep both**, or delete one.
- **New**: added as a confirmed bank transaction (merchant rules apply).
- **Already imported**: the same row was imported before (each row has a stable hash), so nothing is added.
- **Deleted earlier**: the row was imported before and then deleted in Activity, so it isn't imported again.
- **Not imported by default**: money in (income isn't tracked) and transfers/card repayments, which aren't spending. Refunds are imported. Tap any row to change it.

**Deleting.** Any transaction can be deleted: tap it in Activity → **Delete** (tap twice to confirm), or select several in Needs review → **Delete**. Use it for test entries, duplicates and mistakes. Bank-imported rows you delete stay deleted: importing an overlapping CSV later skips them as *Deleted earlier*. If you deleted one by mistake, add it back with **+**.

**Needs review** (Overview banner and the Activity chip) lists transactions with no category, phone captures no import has confirmed after 7 days (*Mark as confirmed* or delete), and possible duplicates. It is grouped by merchant with a count: tap a group to set the category for all of it at once, or tap one of its transactions to edit just that one. Filter by reason (possible duplicates, needs category, unconfirmed) and by card, then tap **Select** → **Select all** (or pick groups) to **Merge**, **Keep both / Confirm**, **Set category** or **Delete** everything selected in one go.

**Money that isn't spending.** In *Settings → Categories & budgets*, set a category's *Count as spending?* to **No** for transfers between your own accounts, paying employees, or passing on money that wasn't yours. Those transactions stay in Activity (marked "Not spending", amount greyed) but are left out of the Overview totals, trend, top merchants, Activity day totals and Budgets. A *Transfers* category set up this way is added for you. Combine it with **Always** so a recurring transfer is filed there automatically.

**Merchant names and rules.** Bank text is cleaned before anything else: card prefixes (`V4821`), `Eftpos`, dates (`28/09`), times (`11:32`), store numbers, states and a repeated suburb are removed, so `V4821 28/09 7-Eleven` and `Eftpos 20/09 11:32KBC Surry Hills Surry Hills` become *7-Eleven* and *KBC Surry Hills*. Choosing **Always** when you set a category saves a rule for that cleaned name and applies it straight away to every existing transaction from that merchant ("Applied to N transactions"). A rule can be limited to amounts *under $X* or *$X or more*, so 7-Eleven under $10 can be Coffee and $50+ Transport & fuel; the most specific matching rule wins.

The parser expects ANZ's headerless *date, amount, description* export and NAB's export with a header row, and falls back to any file whose header names a date, an amount (or debit/credit) and a description. If an export doesn't read, the error says which columns it found; share a redacted sample and the parser in `src/lib/bank-csv.ts` can be adjusted.
