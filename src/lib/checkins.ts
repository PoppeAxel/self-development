import { addDays, format, subMonths } from 'date-fns'
import { periodEndISO, periodStartISO } from './dates'
import type { CheckinRating, Goal, GoalCheckin, PeriodType } from './types'

// Pure helpers for the Goals round-8 handoff: milestone maths, value formatting, which
// period a check-up reviews, and the history dots. No supabase import, so
// scripts/goals.check.ts can run them under node.

// --- Values -----------------------------------------------------------------------------

/** "3:14:20" for seconds ≥ 1 h, "42:05" below. Used for every lower-is-better goal. */
export function formatSeconds(total: number): string {
  const s = Math.round(total)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** "3:00" / "3:00:00" / "42:05" → seconds; a plain number passes through. Null if unparseable. */
export function parseGoalValue(text: string, lowerIsBetter: boolean): number | null {
  const t = text.trim().replace(',', '.')
  if (!t) return null
  if (lowerIsBetter && t.includes(':')) {
    const parts = t.split(':').map(Number)
    if (parts.some((p) => !Number.isFinite(p))) return null
    // Two parts read as h:mm for a race goal ("3:00" = three hours), three as h:mm:ss.
    const [h, m, s = 0] = parts
    return h * 3600 + m * 60 + s
  }
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * A weight goal tracks the body-weight log, and what counts is where you are *now* — the
 * latest weigh-in — not the lightest you've ever been. Every other milestone is a best.
 */
export const isWeightGoal = (goal: Pick<Goal, 'auto_metric'>) => goal.auto_metric === 'weight'

/** A goal value in its own terms: weights in kg, other times as h:mm:ss, else a plain number. */
export function formatGoalValue(goal: Pick<Goal, 'lower_is_better' | 'source_exercise' | 'auto_metric'>, v: number): string {
  const n = Math.round(v * 10) / 10
  if (isWeightGoal(goal) || goal.source_exercise) return `${n.toLocaleString('sv-SE')} kg`
  if (goal.lower_is_better) return formatSeconds(v)
  return n.toLocaleString('sv-SE')
}

// --- Milestones -------------------------------------------------------------------------

export interface MilestoneResult {
  date: string
  value: number
  reps?: number | null
}

export interface MilestoneState {
  best: MilestoneResult | null
  /** Improvement since `since` (positive = better), measured from the best before it. */
  gain: number | null
  /** Distance left to the target, never negative. */
  toGo: number | null
  /** Bar: start→best-before-gain in a tint, then the gain in the accent. Percent of start→target. */
  basePct: number
  gainPct: number
}

export function milestoneState(
  goal: Pick<Goal, 'lower_is_better' | 'start_value' | 'target_value'> & Partial<Pick<Goal, 'auto_metric'>>,
  results: MilestoneResult[],
  since: string,
): MilestoneState {
  const lower = goal.lower_is_better
  const better = (a: number, b: number) => (lower ? a < b : a > b)
  // Weight goals read the latest result (ties: the later one in the list), everything else the best.
  const latest = isWeightGoal({ auto_metric: goal.auto_metric ?? null })
  const bestOf = (rs: MilestoneResult[]) =>
    rs.reduce<MilestoneResult | null>((b, r) => (!b || (latest ? r.date >= b.date : better(r.value, b.value)) ? r : b), null)
  const best = bestOf(results)
  const before = bestOf(results.filter((r) => r.date < since))
  const target = goal.target_value
  const start = goal.start_value ?? before?.value ?? null
  const improvement = (from: number, to: number) => (lower ? from - to : to - from)

  const gain = best && (before ?? start) != null ? improvement((before?.value ?? start) as number, best.value) : null
  const toGo = best && target != null ? Math.max(0, improvement(best.value, target)) : null

  let basePct = 0
  let gainPct = 0
  if (best && target != null && start != null && improvement(start, target) > 0) {
    const span = improvement(start, target)
    const pct = (v: number) => Math.min(100, Math.max(0, (improvement(start, v) / span) * 100))
    const total = pct(best.value)
    basePct = before ? Math.min(total, pct(before.value)) : 0
    gainPct = total - basePct
  }
  return { best, gain, toGo, basePct, gainPct }
}

// --- Check-up periods -------------------------------------------------------------------

/**
 * The week/month a check-up reviews: the current one from its last day, otherwise the one
 * before it. The banner only shows while that period still has an unanswered goal.
 */
export function reviewPeriod(periodType: 'week' | 'month', today: Date = new Date()): { start: string; isCurrent: boolean } {
  const current = periodStartISO(periodType, today)
  const todayISO = format(today, 'yyyy-MM-dd')
  if (periodEndISO(periodType, current) === todayISO) return { start: current, isCurrent: true }
  const prev = periodType === 'week' ? addDays(new Date(current + 'T00:00:00'), -7) : subMonths(new Date(current + 'T00:00:00'), 1)
  return { start: periodStartISO(periodType, prev), isCurrent: false }
}

/** done/partly/missed when the data already knows; null leaves it to the user. */
export function suggestRating(goal: Pick<Goal, 'status' | 'target_value'>, progress: number): CheckinRating | null {
  if (goal.status === 'done') return 'done'
  if (goal.target_value == null) return null
  if (progress >= goal.target_value) return 'done'
  return progress > 0 ? 'partly' : 'missed'
}

export type HistoryDot = 'done' | 'partly' | 'missed'

/**
 * The last `n` finished periods of a series, oldest first, as dots. Only periods the series
 * actually had a row for count — a goal started three weeks ago shows three dots, not eight
 * with five fake misses. A row with no check-in reads as missed.
 */
export function historyDots(seriesGoals: Goal[], checkinsByGoal: Map<string, GoalCheckin>, currentStart: string, n = 8): HistoryDot[] {
  return seriesGoals
    .filter((g) => g.period_start < currentStart)
    .sort((a, b) => a.period_start.localeCompare(b.period_start))
    .slice(-n)
    .map((g) => {
      const r = checkinsByGoal.get(g.id)?.rating
      return r === 'done' || r === 'partly' ? r : 'missed'
    })
}

/** Does a year/quarter goal's period contain the given month? (The monthly check-in's scope.) */
export function coversMonth(goal: Pick<Goal, 'period_type' | 'period_start'>, monthStart: string): boolean {
  return goal.period_start <= monthStart && periodEndISO(goal.period_type as PeriodType, goal.period_start) >= monthStart
}
