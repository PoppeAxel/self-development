-- Generalizes weekly_goals into a multi-period, hierarchical goals table so goals can be
-- planned top-down: yearly -> quarterly -> monthly -> weekly. A child goal (e.g. a monthly
-- goal) points at its parent's series_id (not a specific row's id), since the parent gets a
-- new row each time it rolls over into the next period — see rolloverRecurringGoals in
-- src/lib/goals.ts. daily_tasks.goal_series_id still refers to a goals.series_id value;
-- no change needed there since series_id itself is unaffected by this migration.
alter table weekly_goals rename to goals;
alter table goals rename column week_start to period_start;

alter table goals add column period_type text not null default 'week';
alter table goals add constraint goals_period_type_check check (period_type in ('week', 'month', 'quarter', 'year'));

alter table goals add column parent_series_id uuid;

create index goals_period_lookup on goals (user_id, period_type, period_start);
create index goals_parent_series on goals (parent_series_id);
