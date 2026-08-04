# Self Development

A personal PWA for daily recurring tasks, weekly goals, and journaling (weight, mood, notes), with push
notification reminders. Installs to your iPhone home screen via Safari — no App Store needed.

## Stack
- React + TypeScript + Vite, Tailwind CSS, `vite-plugin-pwa`
- Supabase: Postgres database, Auth, Edge Functions, `pg_cron`/`pg_net` for scheduling
- Web Push (VAPID) for notifications, sent from a Supabase Edge Function on a 15-minute cron

## 1. Create accounts (you do this part)
1. **Supabase** — [supabase.com](https://supabase.com), create a free project. Note the **Project URL** and
   **anon public key** (Project Settings → API), and the **service_role key** (same page — keep this secret).
2. **GitHub** — create an empty repo to hold this code (needed for Vercel auto-deploys).
3. **Vercel** — [vercel.com](https://vercel.com), sign in with GitHub.

## 2. Configure environment
```bash
cp .env.local.example .env.local
```
Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from step 1. Leave `VITE_VAPID_PUBLIC_KEY` for step 4.

## 3. Set up the database
Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), then:
```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```
This runs `supabase/migrations/0001_init.sql` (tables + row-level security).

**Don't run `0002_cron.sql` yet** — it needs your project ref and service role key filled in (step 5).

## 4. Generate VAPID keys (for push notifications)
```bash
npx web-push generate-vapid-keys
```
Copy the **public key** into `.env.local` as `VITE_VAPID_PUBLIC_KEY`. Keep both keys handy for the next step.

## 5. Deploy the reminder-sending Edge Function
```bash
supabase functions deploy send-reminders --no-verify-jwt
```
Then set its secrets (Project Settings → Edge Functions → Secrets, or via CLI):
```bash
supabase secrets set VAPID_PUBLIC_KEY=<public-key>
supabase secrets set VAPID_PRIVATE_KEY=<private-key>
supabase secrets set VAPID_SUBJECT=mailto:pontuslarsaxelsson@gmail.com
```
(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-provided to edge functions — no need to set those.)

Now edit `supabase/migrations/0002_cron.sql`, replacing `<PROJECT_REF>` and `<SERVICE_ROLE_KEY>` with your
actual values, then run:
```bash
supabase db push
```
This schedules the function to run every 15 minutes and send any due reminders.

## 6. Run locally
```bash
npm install
npm run dev
```
Sign up with an email/password (this is your private account — data is scoped to you via row-level security).

## 7. Deploy to Vercel
```bash
git init && git add . && git commit -m "Initial commit"
git remote add origin <your-github-repo-url>
git push -u origin main
```
In Vercel: **New Project** → import the repo → it auto-detects Vite. Add the three `VITE_*` env vars from
`.env.local` under Project Settings → Environment Variables, then deploy.

## 8. Install on your iPhone 16 Pro
1. Open the deployed `https://…vercel.app` URL in **Safari** (must be Safari, not Chrome).
2. Tap the Share icon → **Add to Home Screen**.
3. Open the app from the home screen icon (not from Safari) — this is required for push notifications to work.
4. Sign in, go to **Settings → Enable notifications**, allow when prompted.
5. Add a reminder in Settings (e.g. "Log your weight" at 20:00) — it'll arrive as a push notification within
   15 minutes of the scheduled time.

## Project structure
- `src/pages/` — Today (daily tasks), Goals (weekly goals), Journal (weight/mood/notes), Settings (reminders)
- `src/lib/` — Supabase client, types, date helpers, push subscription helper
- `src/sw.ts` — custom service worker (push + notification click handling)
- `supabase/migrations/` — database schema and cron schedule
- `supabase/functions/send-reminders/` — edge function that sends due push notifications
