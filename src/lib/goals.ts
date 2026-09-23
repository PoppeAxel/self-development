import {
  differenceInCalendarDays,
  eachDayOfInterval,
  eachMonthOfInterval,
  eachWeekOfInterval,
  format,
  startOfMonth,
} from 'date-fns'
import { supabase } from './supabase'
import { PERIOD_TYPES, periodEndISO, periodStartISO, weekStartISO } from './dates'
import { isAutoMetric, METRIC_INFO, type AutoMetric } from './metrics'
import { isStrengthWorkout } from './workouts'
import type { Goal, PeriodType } from './types'

// Counts workouts (not minutes) synced from Strava, e.g. "2x gym sessions/week" — distinct
// from AUTO_METRICS in metrics.ts, which sums a daily journal_entries value. Kept separate
// from that registry so Today.tsx's daily-task auto-complete (built around a single day's
// journal value) doesn't have to account for a workouts-table, count-based metric.
export const SESSION_METRICS = ['strength_sessions', 'cardio_sessions', 'cardio_km'] as const
export type SessionMetric = (typeof SESSION_METRICS)[number]

export const SESSION_METRIC_INFO: Record<SessionMetric, { label: string; icon: string; unit: string }> = {
  strength_sessions: { label: 'Gym sessions (Strava)', icon: '🏋️', unit: 'sessions' },
  cardio_sessions: { label: 'Cardio sessions (Strava)', icon: '🏃', unit: 'sessions' },
  // Not a count like the other two — each cardio workout contributes its distance.
  cardio_km: { label: 'Cardio distance (Strava)', icon: '🏃', unit: 'km' },
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

/** What one workout adds to a session metric: 1 for the counts, its km for cardio_km. */
export function sessionMetricValue(metric: SessionMetric, w: { sport_type: string; distance_meters: number | null }): number {
  if (metric === 'strength_sessions') return isStrengthWorkout(w.sport_type) ? 1 : 0
  if (isStrengthWorkout(w.sport_type)) return 0
  return metric === 'cardio_km' ? (w.distance_meters ?? 0) / 1000 : 1
}

async function countWorkoutSessions(metric: SessionMetric, startDate: string, endDate: string): Promise<number> {
  const { data } = await supabase.from('workouts').select('sport_type, distance_meters').gte('date', startDate).lte('date', endDate)
  return (data ?? []).reduce((sum, w) => sum + sessionMetricValue(metric, w), 0)
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

// --- Pace -----------------------------------------------------------------------------
// "Is this goal on track?" — a goal has always known its period, but the card never said
// whether the number was any good: "Run 300 km · 69%" reads as fine until you notice there
// are 16 days left and it is 44 km short. Everything below is a pure function of a Goal
// plus today's date, reading only `target_value` and the period bounds, so metric goals
// and rollups are covered without either knowing about pace.

export interface GoalPace {
  daysTotal: number
  /** 1-based: today counts as elapsed, so day one of a week reads 1 of 7, not 0 of 7. */
  daysElapsed: number
  daysLeft: number
  /** Clamped to [0,1] so a goal left over from a past period cannot overshoot the ring. */
  elapsedFraction: number
  /** Where the calendar says you should be. Null when the goal has no target. */
  expected: number | null
  /** progress − expected: positive is ahead, negative behind. */
  delta: number | null
  onPace: boolean
  perDayNeeded: number | null
  perDayActual: number
  projected: number | null
  /** False for a period that has not begun (possible via rollover timing) — no verdict. */
  started: boolean
}

export function goalPace(goal: Goal, progress: number, today: Date = new Date()): GoalPace {
  const start = new Date(goal.period_start + 'T00:00:00')
  const end = new Date(periodEndISO(goal.period_type, goal.period_start) + 'T00:00:00')
  // Both ends inclusive — a Mon–Sun week is 7 days, not 6.
  const daysTotal = Math.max(1, differenceInCalendarDays(end, start) + 1)
  const rawElapsed = differenceInCalendarDays(today, start) + 1
  const daysElapsed = Math.min(Math.max(rawElapsed, 0), daysTotal)
  const daysLeft = daysTotal - daysElapsed
  const elapsedFraction = Math.min(Math.max(daysElapsed / daysTotal, 0), 1)
  const target = goal.target_value

  const expected = target != null ? target * elapsedFraction : null
  const delta = expected != null ? progress - expected : null
  // The band is 5% of TARGET, not of expected: measured against expected it would be
  // meaninglessly tight on day one of a period and uselessly loose at the end.
  const onPace = target == null || delta == null ? true : Math.abs(delta) <= target * 0.05
  const remaining = target != null ? Math.max(0, target - progress) : null
  // On the last day of the period the whole remainder is due today, not divided by zero.
  const perDayNeeded = remaining == null ? null : daysLeft > 0 ? remaining / daysLeft : remaining
  const perDayActual = daysElapsed > 0 ? progress / daysElapsed : 0

  return {
    daysTotal,
    daysElapsed,
    daysLeft,
    elapsedFraction,
    expected,
    delta,
    onPace,
    perDayNeeded,
    perDayActual,
    projected: target != null ? perDayActual * daysTotal : null,
    started: rawElapsed > 0,
  }
}

export type PaceTone = 'ahead' | 'behind' | 'onPace'

/**
 * The verdict chip: the signed delta in the goal's own unit ("44 km behind"), or a plain
 * "on pace" inside the 5% band. Null when there is nothing honest to say — no target, or a
 * period that has not started. Manual and rollup goals carry no unit, so they read
 * "2 ahead" rather than inventing one.
 */
export function paceVerdict(goal: Goal, pace: GoalPace): { label: string; tone: PaceTone } | null {
  if (pace.delta == null || !pace.started) return null
  if (pace.onPace) return { label: 'on pace', tone: 'onPace' }
  const unit = isGoalMetric(goal.auto_metric) ? goalMetricInfo(goal.auto_metric).unit : ''
  const amount = Math.round(Math.abs(pace.delta)).toLocaleString()
  const ahead = pace.delta > 0
  return {
    label: `${amount}${unit ? ` ${unit}` : ''} ${ahead ? 'ahead' : 'behind'}`,
    tone: ahead ? 'ahead' : 'behind',
  }
}

/** Behind pace, and not already finished — what the "Off pace" filter counts. */
export function isOffPace(pace: GoalPace, done: boolean): boolean {
  return !done && pace.started && pace.delta != null && !pace.onPace && pace.delta < 0
}

/** Done means the target is met; a manual goal without a target falls back to its status. */
export function isGoalDone(goal: Goal, progress: number, isRollup: boolean): boolean {
  const isAuto = isGoalMetric(goal.auto_metric) || isRollup
  if (goal.target_value != null) return progress >= goal.target_value
  return !isAuto && goal.status === 'done'
}

// --- Sub-interval breakdown (the goal detail's bar row) --------------------------------

export type IntervalState = 'past' | 'current' | 'future'
export interface IntervalBucket {
  start: string
  value: number
  state: IntervalState
}

/** A year breaks into months, a quarter or month into weeks, a week into days. */
export const SUB_INTERVAL: Record<PeriodType, 'month' | 'week' | 'day'> = {
  year: 'month',
  quarter: 'week',
  month: 'week',
  week: 'day',
}

export const SUB_INTERVAL_HEADING: Record<PeriodType, string> = {
  year: 'MONTHS THIS YEAR',
  quarter: 'WEEKS IN THIS QUARTER',
  month: 'WEEKS IN THIS MONTH',
  week: 'DAYS IN THIS WEEK',
}

function subIntervalStarts(goal: Goal): string[] {
  const start = new Date(goal.period_start + 'T00:00:00')
  const end = new Date(periodEndISO(goal.period_type, goal.period_start) + 'T00:00:00')
  const kind = SUB_INTERVAL[goal.period_type]
  const dates =
    kind === 'month'
      ? eachMonthOfInterval({ start, end })
      : kind === 'week'
        ? eachWeekOfInterval({ start, end }, { weekStartsOn: 1 })
        : eachDayOfInterval({ start, end })
  return dates.map((d) => format(d, 'yyyy-MM-dd'))
}

/** Which sub-interval a date falls in, expressed as that interval's start — the bucket key. */
function bucketKeyFor(date: string, goal: Goal): string {
  const d = new Date(date + 'T00:00:00')
  const kind = SUB_INTERVAL[goal.period_type]
  if (kind === 'month') return format(startOfMonth(d), 'yyyy-MM-dd')
  if (kind === 'week') return weekStartISO(d)
  return date
}

/**
 * The goal's progress split across its sub-intervals, for the detail view's bar row — the
 * only history the detail screen shows, and deliberately all within the current period.
 * Returns [] for a manual goal with no metric and no children: there is nothing dated to
 * split, so the section is omitted rather than drawn as a row of empty bars.
 */
export async function goalIntervalTotals(goal: Goal, today: Date = new Date()): Promise<IntervalBucket[]> {
  const periodEnd = periodEndISO(goal.period_type, goal.period_start)
  const totals = new Map<string, number>()

  if (isAutoMetric(goal.auto_metric)) {
    const { data } = await supabase
      .from('journal_entries')
      .select('date, value_numeric')
      .eq('type', METRIC_INFO[goal.auto_metric].journalType)
      .gte('date', goal.period_start)
      .lte('date', periodEnd)
    for (const row of data ?? []) {
      const key = bucketKeyFor(row.date, goal)
      totals.set(key, (totals.get(key) ?? 0) + (row.value_numeric ?? 0))
    }
  } else if (isSessionMetric(goal.auto_metric)) {
    const { data } = await supabase
      .from('workouts')
      .select('date, sport_type, distance_meters')
      .gte('date', goal.period_start)
      .lte('date', periodEnd)
    for (const row of data ?? []) {
      const value = sessionMetricValue(goal.auto_metric, row)
      if (!value) continue
      const key = bucketKeyFor(row.date, goal)
      totals.set(key, (totals.get(key) ?? 0) + value)
    }
  } else {
    // A rollup: each child goal's own resolved progress, placed at its period start.
    const { data } = await supabase
      .from('goals')
      .select('*')
      .eq('parent_series_id', goal.series_id)
      .gte('period_start', goal.period_start)
      .lte('period_start', periodEnd)
    const children = (data ?? []) as Goal[]
    if (!children.length) return []
    const resolved = await Promise.all(children.map(resolveGoalProgress))
    children.forEach((child, i) => {
      const key = bucketKeyFor(child.period_start, goal)
      totals.set(key, (totals.get(key) ?? 0) + resolved[i].progress)
    })
  }

  const todayKey = bucketKeyFor(format(today, 'yyyy-MM-dd'), goal)
  return subIntervalStarts(goal).map((start) => ({
    start,
    value: totals.get(start) ?? 0,
    state: start < todayKey ? 'past' : start === todayKey ? 'current' : 'future',
  }))
}
