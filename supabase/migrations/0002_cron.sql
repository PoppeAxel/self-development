-- Schedules the send-reminders edge function every 15 minutes via pg_cron + pg_net.
-- Requires the "pg_cron" and "pg_net" extensions, enabled by default on Supabase projects
-- (Database -> Extensions in the dashboard if not already on).
--
-- Requires the service_role key to already be stored in Supabase Vault under the name
-- 'service_role_key' — run this once in the SQL Editor BEFORE this migration (not committed
-- to git, so the key never ends up in the repo):
--   select vault.create_secret('<your-service-role-key>', 'service_role_key');
--
-- The service role key is required so the edge function can read/update every user's
-- reminders and push subscriptions (bypassing RLS, which is expected here since this
-- is a trusted server-side job, not a user-facing request).

select cron.schedule(
  'send-reminders-every-15-min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://sgfxtgdkixyztnwpiqeb.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
