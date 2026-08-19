-- Adds training_minutes as a synced journal entry type, same shape as steps/sleep_hours:
-- a running daily value, overwritten as sync-strava-workouts recomputes that day's total
-- workout duration. Lets a daily task auto-complete off Strava activity, same as steps.
alter table journal_entries drop constraint journal_entries_type_check;
alter table journal_entries add constraint journal_entries_type_check
  check (type in ('weight', 'mood', 'note', 'steps', 'sleep_hours', 'training_minutes'));

create unique index journal_entries_one_training_minutes_per_day
  on journal_entries (user_id, date)
  where type = 'training_minutes';
