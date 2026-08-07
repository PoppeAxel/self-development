-- A reminder can optionally be tied to a task, so it only fires if that task hasn't
-- been completed yet today (e.g. "remind me at 20:00 if I haven't hit 10k steps").
-- Left null, a reminder behaves exactly as before — unconditional.
alter table reminders add column task_id uuid references daily_tasks(id) on delete set null;
