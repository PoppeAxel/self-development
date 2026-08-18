-- Schedules the sync-strava-workouts edge function every 3 hours via pg_cron + pg_net.
-- Reuses the same 'cron_secret' Vault entry as send-reminders (see 0002_cron.sql) — no
-- new secret needs to be created in Vault for this job. Workout data isn't time-critical
-- the way reminders are, and 8 runs/day is comfortably within Strava's rate limits.

select cron.schedule(
  'sync-strava-workouts-every-3-hours',
  '0 */3 * * *',
  $$
  select net.http_post(
    url := 'https://sgfxtgdkixyztnwpiqeb.supabase.co/functions/v1/sync-strava-workouts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
