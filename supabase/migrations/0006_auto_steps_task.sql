-- Lets a daily task auto-complete itself once today's synced step count (from the
-- log-steps ingestion) reaches a target, instead of requiring a manual check-off.
alter table daily_tasks add column auto_steps_target integer;
