-- One goal per series per period. rolloverRecurringGoals runs on both Today's and Goals'
-- load; two screens loading at the same moment each saw the new week as missing and each
-- inserted it, so the week of 2026-10-05 got every weekly goal twice (47 ms apart).
-- Clear existing doubles first — keeping a copy that has a check-in over one that doesn't,
-- otherwise the earliest — then enforce it, so the client's insert can skip a clash.
with ranked as (
  select
    g.id,
    row_number() over (
      partition by g.series_id, g.period_start
      order by (select count(*) from goal_checkins c where c.goal_id = g.id) desc, g.created_at, g.id
    ) as rn
  from goals g
)
delete from goals where id in (select id from ranked where rn > 1);

alter table goals add constraint goals_series_period_unique unique (series_id, period_start);
