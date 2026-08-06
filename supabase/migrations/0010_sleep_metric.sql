-- Adds sleep_hours as a synced journal entry type, same shape as steps: a running daily
-- value overwritten as the day's Shortcut sync updates it.
alter table journal_entries drop constraint journal_entries_type_check;
alter table journal_entries add constraint journal_entries_type_check
  check (type in ('weight', 'mood', 'note', 'steps', 'sleep_hours'));

create unique index journal_entries_one_sleep_hours_per_day
  on journal_entries (user_id, date)
  where type = 'sleep_hours';
