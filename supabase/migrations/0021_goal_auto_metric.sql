-- Lets a weekly goal track a synced metric (steps, sleep, cardio/strength minutes) automatically,
-- summed across the week from journal_entries, instead of requiring manual +/- bumps.
-- Mirrors daily_tasks.auto_metric (see 0008_generalize_auto_metric.sql) — validated app-side
-- against the same AUTO_METRICS registry, no DB check constraint.
alter table weekly_goals add column auto_metric text;
