-- Distinguishes daily-recurring tasks (the existing default behavior) from one-time
-- tasks, which should stop reappearing once completed rather than resetting every day.
alter table daily_tasks add column recurring boolean not null default true;
