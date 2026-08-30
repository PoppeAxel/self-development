import { supabase } from './supabase'
import { weekEndISO, weekStartISO, weekStartsInRange } from './dates'
import { isAutoMetric, METRIC_INFO, type AutoMetric } from './metrics'
import type { WeeklyGoal } from './types'

// Ensures every recurring goal series has a row for the current week, carrying forward
// title/target/category from its most recent instance. Safe to call on every page load.
export async function rolloverRecurringGoals() {
  const currentWeekStart = weekStartISO()
  const { data: recurring } = await supabase
    .from('weekly_goals')
    .select('*')
    .eq('recurring', true)
    .order('week_start', { ascending: false })

  if (!recurring?.length) return

  const latestBySeries = new Map<string, WeeklyGoal>()
  for (const goal of recurring as WeeklyGoal[]) {
    if (!latestBySeries.has(goal.series_id)) latestBySeries.set(goal.series_id, goal)
  }

  const toCreate = [...latestBySeries.values()].filter((g) => g.week_start < currentWeekStart)
  if (!toCreate.length) return

  await supabase.from('weekly_goals').insert(
    toCreate.map((g) => ({
      user_id: g.user_id,
      title: g.title,
      target_value: g.target_value,
      week_start: currentWeekStart,
      progress: 0,
      status: 'active',
      series_id: g.series_id,
      recurring: true,
      auto_metric: g.auto_metric,
    })),
  )
}

// Live progress for an auto-metric goal: sum of that metric's journal entries across the
// goal's week, so progress always reflects the latest sync instead of a stale bumped value.
export async function autoMetricProgress(goal: WeeklyGoal): Promise<number> {
  if (!isAutoMetric(goal.auto_metric)) return goal.progress
  const { data } = await supabase
    .from('journal_entries')
    .select('value_numeric')
    .eq('type', METRIC_INFO[goal.auto_metric].journalType)
    .gte('date', goal.week_start)
    .lte('date', weekEndISO(goal.week_start))
  return (data ?? []).reduce((sum, e) => sum + (e.value_numeric ?? 0), 0)
}

export interface GoalMetricStat {
  metric: AutoMetric
  achieved: number
  target: number
}

export interface GoalStats {
  totalGoals: number
  completedGoals: number
  metrics: GoalMetricStat[]
}

// Completion + per-metric achieved/target totals across every weekly_goals row whose week
// falls in [periodStart, periodEnd]. Auto-metric goals are re-evaluated against synced journal
// data rather than trusting stored status/progress, so past weeks stay accurate even though
// their progress was never persisted back to the row (see autoMetricProgress above).
export async function computeGoalStats(periodStart: string, periodEnd: string): Promise<GoalStats> {
  const weekStarts = weekStartsInRange(periodStart, periodEnd)
  if (!weekStarts.length) return { totalGoals: 0, completedGoals: 0, metrics: [] }

  const { data } = await supabase
    .from('weekly_goals')
    .select('*')
    .gte('week_start', weekStarts[0])
    .lte('week_start', weekStarts[weekStarts.length - 1])
  const goals = (data ?? []) as WeeklyGoal[]

  const metricTypes = [...new Set(goals.map((g) => g.auto_metric).filter(isAutoMetric))]
  const weeklySumsByMetric = new Map<AutoMetric, Map<string, number>>()
  for (const metric of metricTypes) {
    const { data: entries } = await supabase
      .from('journal_entries')
      .select('date, value_numeric')
      .eq('type', METRIC_INFO[metric].journalType)
      .gte('date', weekStarts[0])
      .lte('date', weekEndISO(weekStarts[weekStarts.length - 1]))
    const byWeek = new Map<string, number>()
    for (const e of entries ?? []) {
      const ws = weekStartISO(new Date(e.date + 'T00:00:00'))
      byWeek.set(ws, (byWeek.get(ws) ?? 0) + (e.value_numeric ?? 0))
    }
    weeklySumsByMetric.set(metric, byWeek)
  }

  let completedGoals = 0
  const metricTotals = new Map<AutoMetric, { achieved: number; target: number }>()
  for (const goal of goals) {
    if (isAutoMetric(goal.auto_metric)) {
      const achieved = weeklySumsByMetric.get(goal.auto_metric)?.get(goal.week_start) ?? 0
      if (goal.target_value != null && achieved >= goal.target_value) completedGoals++
      const totals = metricTotals.get(goal.auto_metric) ?? { achieved: 0, target: 0 }
      totals.achieved += achieved
      totals.target += goal.target_value ?? 0
      metricTotals.set(goal.auto_metric, totals)
    } else if (goal.status === 'done') {
      completedGoals++
    }
  }

  return {
    totalGoals: goals.length,
    completedGoals,
    metrics: [...metricTotals.entries()].map(([metric, t]) => ({ metric, achieved: t.achieved, target: t.target })),
  }
}
