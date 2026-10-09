# Changelog

## 1.1.0 — 2026-10-09

### New

- Refreshed mobile design with a teal household summary, clearer activity rows, and recent purchases on Overview.
- Light, Dark and System appearance choices in Settings, remembered on each device.
- Compact quick-add category picker, optional merchant name, and a Save button showing the amount.
- Brief save confirmation and subtle interaction feedback, with reduced-motion support.

### Improved

- Quick add preserves entered details after a network error so you can retry.
- Keyboard entry respects the merchant field; sheets keep keyboard focus within the dialog and restore it on close.
- Updated light and dark screenshots throughout the README.

### Updating

Pull the latest changes into your copy and deploy as usual. This release adds no dependencies, database migrations, or required environment variables. The Vercel deploy button and existing household data remain compatible. Find your installed version in **Settings → About**.

## 1.0.0

Initial release: shared household spending, phone capture, bank CSV import, budgets, and self-hosting with Supabase and Vercel.
