# Budget alerts

When a category reaches **80%** and then **100%** of its monthly budget, every phone in the household with alerts on gets a notification, whoever made the purchase:

> **Eating out: 82% of budget**
> $72.00 left for 11 days · $6.54/day.

> **Eating out is over budget**
> $412.50 of $400.00 spent this month, $12.50 over.

Tapping the notification opens Budgets.

The same phones also get a short note on Mondays when any of last week's payments weren't logged (a card that isn't saved in the app, or a notification it couldn't read):

> **2 payments weren't logged last week**
> They were on cards not saved in the app. Tap to check the Capture log.

It arrives with the first purchase logged that Monday, and a quiet week sends nothing.

## Turning them on

Do this on each phone, in the installed app:

1. Set a monthly budget for the categories you care about: *Settings → Categories & budgets*.
2. *Settings → Budget alerts → Turn on for this phone*, and allow notifications when asked.
3. Tap **Send a test notification** to check it arrives.

**iPhone:** notifications only work in the app added to the Home Screen (Safari → Share → **Add to Home Screen**), on iOS 16.4 or later. In Safari itself the screen asks you to install the app first.

**Android:** works in Chrome, installed or not. If nothing arrives, check that Chrome (or the installed app) may show notifications, and that battery saving isn't restricting it.

Turn alerts off for a phone on the same screen. Signing out doesn't turn them off; a phone you give away should turn them off first.

## When an alert is sent

- After anything that adds or recategorises spending: a phone capture, quick add, a bank CSV import, changing a transaction's category, or merging a duplicate.
- Spending is counted for the current calendar month in Sydney time, the same as the Budgets screen. Refunds count against spending. Categories marked as not spending never alert.
- Each category gets its 80% alert and its 100% alert **once per month**. A refund that brings it back under 80% and more spending afterwards doesn't repeat the alert. If one purchase takes a category from under 80% to over 100%, you get only the "over budget" one.
- While nobody has alerts on, nothing is recorded, so if you turn them on mid-month, the next purchase tells you about any category that's already past 80%.
- If you lower a budget mid-month, the next purchase sends any alert that's now due. If you raise it after an alert went out, that alert won't be sent again until next month.

## How it's set up

Web push needs a key pair (VAPID keys) so that Apple's and Google's push services know the alerts come from your app.

- **One-click deploy:** nothing to do. The first deploy creates the keys and keeps them in your database (`private.push_keys`, which the app's API can't read), and every deploy hands them to the server.
- **Manual setup without a database URL in Vercel:** generate a pair with `npx web-push generate-vapid-keys` and add them in Vercel as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, then redeploy. Env vars always take precedence over the database pair.
- **Optional `VAPID_SUBJECT`:** a `mailto:you@example.com` or `https://` address push services can contact about your app. It defaults to your app's own address.

If the keys ever change (you set the env vars later, or recreate the database), turn alerts off and on again on each phone.

**Local development:** put `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in `.env.local` and restart `npm run dev`. Browsers allow push on `http://localhost`.

## Troubleshooting

- **"Alerts aren't set up on this copy of the app yet"**: the deploy didn't find a database URL or VAPID env vars. Connect Supabase in Vercel (or add the env vars above) and redeploy.
- **"Notifications are blocked"**: you said no to the permission prompt. iPhone: *Settings → Notifications → Our spending*. Android: long-press the app icon → *App info → Notifications*.
- **Android: "This phone received the test" but no notification:** the phone is hiding it. On Pixel phones, *Notification organizer* can file the alerts under Promotions and silence them: exclude the app or turn the organizer off (*Settings → Notifications → Notification organizer*). Also check the app's notification categories (long-press the icon → *App info → Notifications*) and that Chrome's battery use is Unrestricted.
- **Test works but no budget alerts:** check the category has a budget, counts as spending, and that this month's spending in it has crossed 80% since alerts were turned on. Each alert is sent only once a month.
- **A phone stopped getting them:** if the app was deleted or notifications were reset, the push service tells the app the subscription has gone, and it's removed from the list. Turn alerts on again on that phone.
