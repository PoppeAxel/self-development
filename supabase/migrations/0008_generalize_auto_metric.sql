-- Generalizes the steps-only auto-complete field into a metric + target pair, so future
-- synced metrics (sleep hours, etc.) can drive task auto-completion the same way without
-- another schema change per metric.
alter table daily_tasks add column auto_metric text;
alter table daily_tasks add column auto_metric_target numeric;

update daily_tasks
set auto_metric = 'steps', auto_metric_target = auto_steps_target
where auto_steps_target is not null;

alter table daily_tasks drop column auto_steps_target;
