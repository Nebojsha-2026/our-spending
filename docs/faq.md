# FAQ

**Is it really free?**
Yes. Vercel's Hobby plan is free for personal, non-commercial use (a household app is), and Supabase's free plan gives you a 500 MB database: years of household transactions. There's no subscription, no ads and nothing sent anywhere but your own database.

**My Supabase project says "paused".**
Supabase pauses free projects after a week with no activity. Daily phone captures keep it awake, but after a quiet holiday it can happen. Open the project in the Supabase dashboard and press **Restore**; nothing is lost. The app shows errors until it's back.

**Why does a purchase say "Card payment"?**
Google Wallet sometimes doesn't know the shop's name when you tap (its notification is titled with your card, e.g. "Visa ••1234"). The purchase is saved anyway and the name fills in by itself when your bank app's notification for it arrives, or when you import the bank CSV. The original notification text is in the transaction's note.

**What's the Monday "payments weren't logged" note?**
Once a week, phones with alerts on get a short note if any of last week's payments weren't logged: a card that isn't saved in the app, or a notification it couldn't read. Tap it to see them in the *Capture log*. Refunds, transfers and other notifications skipped on purpose don't count, and a quiet week sends nothing.

**What does "Unconfirmed" mean?**
A phone capture the bank hasn't confirmed yet. When you import the bank's CSV, matching rows confirm it (same card, same amount, within 3 days). If it's still unconfirmed after 7 days it shows in *Needs review*: maybe it was paid with a card you don't import (mark it confirmed) or the payment didn't go through (delete it).

**Will the bank CSV duplicate what the phones already logged?**
No. Each CSV row is matched against phone captures and manual entries first; a match is merged, not added. When it isn't sure (two $4.50 coffees in three days, or a manual entry with a different name), it imports the row and flags it in *Needs review*, where **Merge** shows both side by side first. Re-importing the same file adds nothing.

**What about Afterpay, Zip and other buy now, pay later?**
Count the repayments, not the purchase. Each repayment comes out of your debit or credit card, so the app logs it like any other card payment: from the bank app's notification on Android, and from the bank CSV on any phone. That way a $40 order paid in four parts adds up to $40, never $80. Two things help:
- Only cards saved in *Settings → Accounts & cards* are logged, so tapping an Afterpay or Zip card in Apple Wallet doesn't add the full price on top: it goes to the *Capture log* instead. Just don't save that card in the app.
- Repayments arrive named after the provider (e.g. *Afterpay*). Give one a category and tap **Always**, and every repayment after it follows.

**The sign-in email didn't arrive.**
Check spam. Supabase's built-in sender allows only a few emails an hour; wait a bit, or add your own SMTP under *Supabase → Authentication → Emails*. If the email has a link but no 6-digit code, the sign-in email template wasn't set up: see [manual setup](manual-setup.md#supabase), step 4.

**Can more than two people use it?**
Yes: add everyone under *Settings → Household* (partner, family, housemates). It works best for 2–4 people.

**My bank isn't ANZ or NAB.**
CSV exports from other banks are read by the generic importer (any file with a date, amount and description column). For Android capture, add your bank's app to the MacroDroid macro's trigger. If something isn't recognised, open an issue with a redacted sample.

**Is my data private?**
It lives only in your own Supabase database. Row-level security means each signed-in person sees only their household's rows. Phone tokens are stored only as a hash; card numbers are never stored (just a nickname and the last 4 digits). *Settings → Export everything to CSV* gives you all of it.

**How do I update to the latest version?**
Pull the latest code into your copy of the repo and push (see the README's *Updating*). Vercel redeploys and applies any new database changes first.

**How do I make the coffee card go away?**
Tap **I've already supported** (it's on trust) or **Maybe later** (hides it for a month). It only appears once the app has logged 50 transactions.

**How do I see the welcome tour again?**
*Settings → About → Take the tour.*
