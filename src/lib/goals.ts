import { supabase } from './supabase'
import { PERIOD_TYPES, periodEndISO, periodStartISO } from './dates'
import { isAutoMetric, METRIC_INFO, type AutoMetric } from './metrics'
import { isStrengthWorkout } from './workouts'
import type { Goal, PeriodType } from './types'

// Counts workouts (not minutes) synced from Strava, e.g. "2x gym sessions/week" — distinct
// from AUTO_METRICS in metrics.ts, which sums a daily journal_entries value. Kept separate
// from that registry so Today.tsx's daily-task auto-complete (built around a single day's
// journal value) doesn't have to account for a workouts-table, count-based metric.
export const SESSION_METRICS = ['strength_sessions', 'cardio_sessions'] as const
export type SessionMetric = (typeof SESSION_METRICS)[number]

export const SESSION_METRIC_INFO: Record<SessionMetric, { label: string; icon: string; unit: string }> = {
  strength_sessions: { label: 'Gym sessions (Strava)', icon: '🏋️', unit: 'sessions' },
  cardio_sessions: { label: 'Cardio sessions (Strava)', icon: '🏃', unit: 'sessions' },
}

export function isSessionMetric(value: string | null): value is SessionMetric {
  return value != null && (SESSION_METRICS as readonly string[]).includes(value)
}

export type GoalMetric = AutoMetric | SessionMetric

export function isGoalMetric(value: string | null): value is GoalMetric {
  return isAutoMetric(value) || isSessionMetric(value)
}

export function goalMetricInfo(metric: GoalMetric): { label: string; icon: string; unit: string } {
  return isAutoMetric(metric) ? METRIC_INFO[metric] : SESSION_METRIC_INFO[metric]
}

async function countWorkoutSessions(metric: SessionMetric, startDate: string, endDate: string): Promise<number> {
  const { data } = await supabase.from('workouts').select('sport_type').gte('date', startDate).lte('date', endDate)
  return (data ?? []).filter((w) => isStrengthWorkout(w.sport_type) === (metric === 'strength_sessions')).length
}

// Ensures every recurring goal series (of every period type) has a row for its current
// period, carrying forward title/target/metric/parent from its most recent instance. Safe
// to call on every page load.
export async function rolloverRecurringGoals() {
  const { data: recurring } = await supabase.from('goals').select('*').eq('recurring', true).order('period_start', { ascending: false })
  if (!recurring?.length) return

  const latestBySeries = new Map<string, Goal>()
  for (const goal of recurring as Goal[]) {
    if (!latestBySeries.has(goal.series_id)) latestBySeries.set(goal.series_id, goal)
  }

  const currentStartByPeriod = Object.fromEntries(PERIOD_TYPES.map((p) => [p, periodStartISO(p)])) as Record<PeriodType, string>

  const toCreate = [...latestBySeries.values()].filter((g) => g.period_start < currentStartByPeriod[g.period_type])
  if (!toCreate.length) return

  await supabase.from('goals').insert(
    toCreate.map((g) => ({
      user_id: g.user_id,
      title: g.title,
      target_value: g.target_value,
      period_type: g.period_type,
      period_start: currentStartByPeriod[g.period_type],
      progress: 0,
      status: 'active',
      series_id: g.series_id,
      recurring: true,
      auto_metric: g.auto_metric,
      parent_series_id: g.parent_series_id,
    })),
  )
}

// Live progress for a metric-linked goal: sum (journal metrics) or count (session metrics)
// across the goal's period, so progress always reflects the latest sync instead of a stale
// bumped value.
export async function autoMetricProgress(goal: Goal): Promise<number> {
  const periodEnd = periodEndISO(goal.period_type, goal.period_start)
  if (isSessionMetric(goal.auto_metric)) {
    return countWorkoutSessions(goal.auto_metric, goal.period_start, periodEnd)
  }
  if (!isAutoMetric(goal.auto_metric)) return goal.progress
  const { data } = await supabase
    .from('journal_entries')
    .select('value_numeric')
    .eq('type', METRIC_INFO[goal.auto_metric].journalType)
    .gte('date', goal.period_start)
    .lte('date', periodEnd)
  return (data ?? []).reduce((sum, e) => sum + (e.value_numeric ?? 0), 0)
}

export interface GoalProgress {
  progress: number
  // True when this goal has no metric of its own and its number comes from summing child
  // goals (e.g. a quarterly "8 gym sessions" made up of four weekly "2 sessions" goals)
  // instead of a manually bumped or synced value.
  isRollup: boolean
}

// Resolves a goal's current progress: its own synced metric if it has one, otherwise the
// sum of every child goal (any goal whose parent_series_id points at this one) whose period
// falls within this goal's period — recursively, so a yearly goal correctly sums weekly
// progress through its quarterly/monthly children. Falls back to the manually bumped value
// for a plain leaf goal with no metric and no children.
export async function resolveGoalProgress(goal: Goal): Promise<GoalProgress> {
  if (isGoalMetric(goal.auto_metric)) {
    return { progress: await autoMetricProgress(goal), isRollup: false }
  }
  const periodEnd = periodEndISO(goal.period_type, goal.period_start)
  const { data } = await supabase
    .from('goals')
    .select('*')
    .eq('parent_series_id', goal.series_id)
    .gte('period_start', goal.period_start)
    .lte('period_start', periodEnd)
  const children = (data ?? []) as Goal[]
  if (!children.length) return { progress: goal.progress, isRollup: false }

  const childResults = await Promise.all(children.map(resolveGoalProgress))
  return { progress: childResults.reduce((sum, c) => sum + c.progress, 0), isRollup: true }
}
