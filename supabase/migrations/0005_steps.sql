-- Allow a 'steps' journal entry type (ingested from Garmin via Apple Health + a Shortcut),
-- and a per-user daily step goal.

alter table journal_entries drop constraint journal_entries_type_check;
alter table journal_entries add constraint journal_entries_type_check
  check (type in ('weight', 'mood', 'note', 'steps'));

-- Steps are a running daily total (overwritten as the day progresses), unlike weight/mood
-- which are intentionally multi-entry, so give the ingestion endpoint something to upsert on.
create unique index journal_entries_one_steps_per_day
  on journal_entries (user_id, date)
  where type = 'steps';

alter table user_settings add column step_goal integer;
