# Manual setup

The [one-click deploy](../README.md#deploy-your-own-free) does all of this for you. Use these steps if you'd rather wire Supabase and Vercel up yourself, or to fix a setting by hand.

## Supabase

1. **Create a project**: pick the region nearest you (Sydney is *ap-southeast-2*).
2. **Run the migrations** in `supabase/migrations/`, in filename order. Either paste each file into *SQL Editor → New query → Run*, or with the CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
3. **Authentication → URL Configuration**
   - Site URL: `https://<your-app>.vercel.app`
   - Redirect URLs: `https://<your-app>.vercel.app/**` and `http://localhost:3000/**`
4. **Authentication → Emails → Templates**: edit both **Magic Link** and **Confirm signup** so the email carries the 6-digit code (an installed iPhone app can't receive a magic link; it opens Safari, which has separate storage):

   ```html
   <h2>Your sign-in code</h2>
   <p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
   <p>Or on this device, <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">sign in with this link</a>.</p>
   ```
5. **Google sign-in (optional)**: *Authentication → Sign In / Providers → Google*. Create an OAuth client in Google Cloud (type *Web application*) with authorised redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`, then paste its client ID and secret into Supabase.
6. **Keys**: *Project Settings → API Keys*: copy the **publishable** key (or legacy `anon` key) and the project URL. No service-role key is needed.
7. **Once everyone in the household has signed in**: turn off *Allow new users to sign up* so nobody else can create an account.

Supabase's free plan email sender is rate-limited (a few emails an hour). That's plenty for a household; if you hit it, add your own SMTP under *Authentication → Emails*.

## Vercel

1. *Add New → Project* → import your copy of this repo (framework preset: Next.js, defaults are fine).
2. *Settings → Environment Variables*, for Production, Preview and Development:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
   - optional `POSTGRES_URL_NON_POOLING`: the database connection string (*Supabase → Connect → Session pooler*). With it, every deploy applies new migrations automatically and sets up the keys for budget alerts.
   - optional `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`: keys for [budget alerts](budget-alerts.md#how-its-set-up), from `npx web-push generate-vapid-keys`. Only needed without a database URL. Optional `VAPID_SUBJECT` (`mailto:` or `https://` address) too.
3. *Settings → Functions → Function Region*: the region next to your database (Sydney is **syd1**).
4. Deploy, then put the production URL into Supabase's Site URL and Redirect URLs (step 3 above).

## Updating

Pull the latest version into your copy (`git pull https://github.com/Nebojsha-2026/our-spending main`, then `git push`). Vercel redeploys, and if a database URL is set the build applies any new migrations first. Without one, run the new files from `supabase/migrations/` in the SQL Editor.
