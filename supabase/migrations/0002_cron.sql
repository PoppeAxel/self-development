-- Schedules the send-reminders edge function every 15 minutes via pg_cron + pg_net.
-- Requires the "pg_cron" and "pg_net" extensions, enabled by default on Supabase projects
-- (Database -> Extensions in the dashboard if not already on).
--
-- Requires a shared secret to already be stored in Supabase Vault under the name
-- 'cron_secret', matching the CRON_SECRET edge function secret — run this once in the
-- SQL Editor BEFORE this migration (not committed to git, so the key never ends up in
-- the repo):
--   select vault.create_secret('<same-value-as-CRON_SECRET-edge-function-secret>', 'cron_secret');
--
-- A dedicated secret (rather than the project's service_role key) is used here so this
-- job's auth doesn't depend on which of Supabase's key formats happens to be injected
-- into edge functions at runtime.

select cron.schedule(
  'send-reminders-every-15-min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://sgfxtgdkixyztnwpiqeb.supabase.co/functions/v1/send-reminders',
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
