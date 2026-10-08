# Phone capture

Each phone gets its own device token from *Settings → Devices → Add a phone*. With the quick setup it takes about 3 minutes per phone; by hand, about 10.

## Android: quick setup (MacroDroid macro file)

1. Install **MacroDroid** from the Play Store. Allow **Notification access** when it asks, and set its battery use to **Unrestricted** (*Settings → Apps → MacroDroid → App battery usage*), or Android may stop it in the background.
2. In the app, on that phone: *Settings → Devices → Add a phone* → **Android** → pick the person → **Create token** → **Download the MacroDroid macro**.
3. Open the downloaded `our-spending.macro` with MacroDroid and tap **Import**. (Or in MacroDroid: ⋮ → *Export / Import* → *Import* → pick it from Downloads.)
4. In **Google Wallet**, make sure payment notifications are on. In your **bank's app**, turn on purchase notifications if it offers them: they carry the shop name when Wallet's don't.
5. Make a small tap payment and check *Activity*.

The macro listens to Google Wallet and the ANZ, NAB, CommBank and Westpac apps. With another bank, open the macro in MacroDroid → the *Notification Received* trigger → add your bank's app. The file contains this phone's token, so don't share it; if it leaks, revoke the phone in *Settings → Devices* and add it again.

### Android notification tips

- **Battery:** MacroDroid (and Chrome, for budget alerts) should be **Unrestricted**. A restricted app misses notifications while the phone sleeps.
- **Notification organizer (Pixel):** Android's organizer can file the app's budget alerts under *Promotions* and silence them. If alerts don't show, exclude the app from the organizer or turn it off (*Settings → Notifications → Notification organizer*).
- **Nothing logged?** *Settings → Capture log* lists every notification the app got but didn't save, with the reason. If it's empty, the notification never left the phone: check MacroDroid's notification access and that the macro is enabled.

## iPhone: quick setup (ready-made Shortcut)

If *Settings → Devices → Add a phone → iPhone* shows **Get the Shortcut**:

1. Tap **Get the Shortcut** → **Add Shortcut**. When it asks, paste the **URL** and the **Authorization header** shown on that screen (tap their Copy buttons).
2. **Shortcuts → Automation → + → Transaction**: pick your cards (or all), leave merchants/categories on Any, choose **Run Immediately**, tap **Next** and pick the **Our spending** shortcut.
3. Make a small tap payment and check *Activity*.

If there's no *Get the Shortcut* button, build it by hand below (it's the same thing, step by step).

## iPhone: by hand (Shortcuts "Transaction" automation)

1. In the app: *Settings → Devices → Add a phone*. Copy the **URL** and **Authorization header** it shows (the token is shown once).
2. On the iPhone: **Shortcuts → Automation → + → Transaction**. Choose your cards (or all), leave merchants/categories on Any, select **Run Immediately**, and turn off *Notify When Run*.
3. Add **Get Contents of URL**:
   - URL: the copied URL (`https://<your-app>.vercel.app/api/ingest`)
   - Method: **POST**
   - Headers: `Authorization` = the copied `Bearer het_…` value
   - Request Body: **JSON** with `amount` → *Shortcut Input › Amount*, `merchant` → *Merchant*, `card` → *Card or Pass*, `source` → text `apple_pay`
4. Optional confirmation banner: add **Get Dictionary Value** (key `message`) from *Contents of URL*, then **Show Notification** with it → "Logged $23.50 · Groceries".
5. Test with a small tap payment; it appears in Activity straight away (marked *Unconfirmed* until a bank CSV import confirms it).

Name each card's nickname in *Settings → Accounts & cards* the way Wallet shows it (e.g. "ANZ Visa") so captures land on the right card; otherwise they fall back to that person's default card.

Test the endpoint without a phone:

```bash
curl -X POST https://<your-app>.vercel.app/api/ingest \
  -H "Authorization: Bearer het_…" -H "Content-Type: application/json" \
  -d '{"amount":"$1.00","merchant":"TEST 0001 SYDNEY","card":"ANZ Visa","source":"apple_pay"}'
```

Responses: `201` logged · `200` duplicate of a capture in the last 2 minutes (not saved twice) · `400` unreadable amount · `401` bad or revoked token · `429` more than 20 captures in 10 minutes.


## Android: by hand (MacroDroid notification forwarding)

The phone forwards the raw notification text; the server does the parsing, so if a bank changes its wording the fix is in code, not on the phone.

1. In the app: *Settings → Devices → Add a phone*, choose **Android** and the person. Copy the **URL**, **Authorization header** and **Request body** it shows.
2. Install **MacroDroid**, grant **Notification access**, and set its battery usage to **Unrestricted** (Settings → Apps → MacroDroid), or Android may stop it in the background.
3. In Google Wallet, turn payment notifications on. In your bank's app, turn on purchase notifications if it offers them.
4. New macro. **Trigger:** Notification Received → apps *Google Wallet* and your bank's app.
5. **Action:** HTTP Request → **POST** to the URL, header `Authorization` = the copied `Bearer het_…`, content type `application/json`, body:

   ```json
   {"raw": "[notification_title] | [notification]", "app": "[app_name]", "source": "android"}
   ```
   (the `|` between title and text helps the parser; quotes or line breaks in a notification are handled).
6. Make a small tap payment and check Activity.

## What the server does with each notification

- **Purchase** → saved like an Apple Pay capture (merchant rules, card matched by its last 4 digits or nickname). When Google Wallet *and* the bank app both notify for one purchase, the second is recognised as the same person, same amount within 2 minutes, and not saved twice.
- **Not a purchase** (declined, refund, money in, transfer, balance/statement alert) → skipped and listed in *Settings → Capture log*.
- **Purchase with no shop name**: Google Wallet sometimes titles the notification with the card ("Visa ••1234") when the shop's terminal didn't send a name. It's saved as **Card payment**, with the notification text in its note. The shop name fills in by itself when the bank app's notification for the same purchase arrives (within 2 minutes), or when a bank CSV import confirms it. Turning on purchase notifications in the bank app gets you the name straight away.
- **Couldn't read it** → listed in *Capture log* with the reason. Copy the text from there so a pattern can be added for that wording, and add the purchase with **+** meanwhile.
