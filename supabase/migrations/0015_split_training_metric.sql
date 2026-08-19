-- Replaces the single training_minutes metric with two separate ones (cardio vs
-- strength), so a daily task can auto-complete off either independently.
drop index if exists journal_entries_one_training_minutes_per_day;

alter table journal_entries drop constraint journal_entries_type_check;
alter table journal_entries add constraint journal_entries_type_check
  check (type in ('weight', 'mood', 'note', 'steps', 'sleep_hours', 'cardio_minutes', 'strength_minutes'));

create unique index journal_entries_one_cardio_minutes_per_day
  on journal_entries (user_id, date)
  where type = 'cardio_minutes';

create unique index journal_entries_one_strength_minutes_per_day
  on journal_entries (user_id, date)
  where type = 'strength_minutes';
