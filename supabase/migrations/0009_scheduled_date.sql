-- A task can be scheduled for a future date, staying hidden from Today until then.
-- Null means "today, as always" — existing tasks are unaffected.
alter table daily_tasks add column scheduled_date date;
