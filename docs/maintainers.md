# Maintainer notes

For whoever publishes this repo (not needed to run your own copy).

## Links shown in the app

`src/lib/project.ts`: the repo link, the Buy Me a Coffee link (also in `README.md` and `.github/FUNDING.yml`), and the iPhone Shortcut link below. A `null` link is simply not shown.

## Publishing the iPhone Shortcut

The app's *Settings → Devices → iPhone* offers **Get the Shortcut** once `iphoneShortcutUrl` is set. It's optional: without it the app shows the step-by-step instructions.

Apple doesn't let **automations** be shared, only shortcuts. So it has to be built as a standalone shortcut in the *Shortcuts* tab (not inside an automation), and iCloud sync for Shortcuts must be on (*Settings → Apps → Shortcuts → iCloud Sync*) for *Copy iCloud Link* to appear. Make it once, on an iPhone:

1. **Shortcuts → +** → name it **Our spending**.
2. Add a **Text** action with a placeholder like `https://your-app.vercel.app/api/ingest`. Add a second **Text** action with `Bearer het_your-token`.
3. Add **Get Contents of URL**: URL = the first Text; *Show More* → Method **POST**; Headers: `Authorization` = the second Text; Request Body **JSON** with `amount` → *Shortcut Input › Amount*, `merchant` → *Shortcut Input › Merchant*, `card` → *Shortcut Input › Card or Pass*, `source` → text `apple_pay`.
4. Add **Get Dictionary Value** → key `message` from *Contents of URL*, then **Show Notification** with *Dictionary Value*.
5. In the shortcut's details (ⓘ), turn on receiving input from **Wallet transactions** (wording varies by iOS version), then open **Setup → Import Questions** and add a question for each Text action: "Paste the URL from Settings → Devices" and "Paste the Authorization header from Settings → Devices". Clear both Text actions' default values so nobody's token ships in the link.
6. Test it with your own automation (*Automation → + → Transaction → Run Immediately →* this shortcut), then **Share → Copy iCloud Link** and put it in `iphoneShortcutUrl`.

## Screenshots

`npm run screenshots` rebuilds the app against a mock Supabase (`scripts/screenshots/mock-supabase.mjs`, sample household Alex & Sam) and saves light/dark images to `docs/screenshots/`. `ONLY=overview,quick-add` limits it; `OUT_DIR=…` saves elsewhere. Needs Chromium (`CHROMIUM_PATH`, or `npx playwright install chromium`).

## Database changes

Add a new file to `supabase/migrations/` named `YYYYMMDDNNNNNN_what.sql` (never edit one that's been released). Every deploy with a database URL applies new files in order (`scripts/setup.mjs`), and `npm test` runs them all on PGlite (`supabase/tests/db.test.ts`).
