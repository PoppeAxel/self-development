import { addDays, format, parseISO } from 'date-fns'
import { weekStartISO } from './dates'
import { dailyKcalTotals, MIN_LOGGED_KCAL } from './food'
import { isStrengthWorkout } from './workouts'
import type { FoodLogEntry, Ingredient, JournalEntry, JournalEntryType, Recipe, RecipeIngredient, Workout } from './types'

// Journal and the Weekly review need the same thing: daily values bucketed into Mon–Sun
// weeks, with an average, a total, and a week-over-week trend. Journal grew three
// near-identical copies of that logic (weight, sleep, steps) plus two sum-only ones
// (cardio distance, strength minutes); this is the one implementation they all use.
// (The Insights view was a third reader until it was removed in 2026-09-15.)

export interface WeekBucket {
  weekStart: string
  values: number[]
  avg: number
  min: number
  max: number
  total: number
  /** Number of days that actually had a value — never assume 7. */
  count: number
}

/** Buckets dated numeric values into Mon-start weeks, ascending by weekStart. */
export function bucketByWeek(rows: { date: string; value: number }[]): WeekBucket[] {
  const byWeek = new Map<string, number[]>()
  for (const row of rows) {
    const wk = weekStartISO(parseISO(row.date))
    const arr = byWeek.get(wk) ?? []
    arr.push(row.value)
    byWeek.set(wk, arr)
  }
  return [...byWeek.entries()]
    .map(([weekStart, values]) => ({
      weekStart,
      values,
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      total: values.reduce((a, b) => a + b, 0),
      count: values.length,
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

/** The metric a caller reads off a bucket — weight wants `avg`, cardio km wants `total`. */
export type WeekMeasure = (bucket: WeekBucket) => number

export const byAvg: WeekMeasure = (b) => b.avg
export const byTotal: WeekMeasure = (b) => b.total

/** Latest bucket, the one before it, and the change between them. */
export function weekOverWeek(
  buckets: WeekBucket[],
  measure: WeekMeasure = byAvg,
): { current: WeekBucket | null; previous: WeekBucket | null; change: number | null } {
  const current = buckets[buckets.length - 1] ?? null
  const previous = buckets[buckets.length - 2] ?? null
  return { current, previous, change: current && previous ? measure(current) - measure(previous) : null }
}

/**
 * Average week-over-week change across the last few weeks — a steadier read than a single
 * week's delta, which is what the maintenance estimate and the goal ETA both lean on.
 */
export function trendPerWeek(buckets: WeekBucket[], measure: WeekMeasure = byAvg, window = 5): number | null {
  const recent = buckets.slice(-window)
  const diffs: number[] = []
  for (let i = 1; i < recent.length; i++) diffs.push(measure(recent[i]) - measure(recent[i - 1]))
  return diffs.length > 0 ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null
}

/** The bucket for one specific week, or null if nothing was logged that week. */
export function weekAt(buckets: WeekBucket[], weekStart: string): WeekBucket | null {
  return buckets.find((b) => b.weekStart === weekStart) ?? null
}

/** The bucket for the week before `weekStart`. */
export function weekBefore(buckets: WeekBucket[], weekStart: string): WeekBucket | null {
  const earlier = buckets.filter((b) => b.weekStart < weekStart)
  return earlier[earlier.length - 1] ?? null
}

// --- Source adapters: raw table rows → {date, value} ---

export function journalWeeks(entries: JournalEntry[], type: JournalEntryType): WeekBucket[] {
  return bucketByWeek(
    entries
      .filter((e) => e.type === type && e.value_numeric != null)
      .map((e) => ({ date: e.date, value: e.value_numeric as number })),
  )
}

/** Weekly kilometres from non-strength Strava workouts. Read these with `byTotal`. */
export function cardioDistanceWeeks(workouts: Workout[]): WeekBucket[] {
  return bucketByWeek(
    workouts
      .filter((w) => !isStrengthWorkout(w.sport_type))
      .map((w) => ({ date: w.date, value: (w.distance_meters ?? 0) / 1000 })),
  )
}

/** Weekly minutes from strength Strava workouts. Read these with `byTotal`. */
export function strengthMinutesWeeks(workouts: Workout[]): WeekBucket[] {
  return bucketByWeek(
    workouts.filter((w) => isStrengthWorkout(w.sport_type)).map((w) => ({ date: w.date, value: w.duration_seconds / 60 })),
  )
}

/** Number of workouts per week, split strength vs cardio. Read with `byTotal`. */
export function sessionCountWeeks(workouts: Workout[], kind: 'strength' | 'cardio'): WeekBucket[] {
  return bucketByWeek(
    workouts.filter((w) => isStrengthWorkout(w.sport_type) === (kind === 'strength')).map((w) => ({ date: w.date, value: 1 })),
  )
}

/**
 * kcal per logged day, bucketed by week. `avg` is kcal/day over the days actually logged —
 * missing days are excluded rather than counted as zero, so a half-logged week doesn't read
 * as a crash diet. A day under `MIN_LOGGED_KCAL` is treated the same way as a missing one:
 * it's a day a meal never got logged, not a day of eating 300 kcal.
 */
export function intakeKcalWeeks(
  foodEntries: FoodLogEntry[],
  recipes: Recipe[],
  recipeLines: Map<string, RecipeIngredient[]>,
  ingredients: Ingredient[],
): WeekBucket[] {
  const kcalByDate = dailyKcalTotals(foodEntries, recipes, recipeLines, ingredients)
  return bucketByWeek(
    [...kcalByDate.entries()]
      .filter(([, value]) => value >= MIN_LOGGED_KCAL)
      .map(([date, value]) => ({ date, value })),
  )
}

// --- Week labels ---

/** "Sep 7 – Sep 13" for the week navigator. */
export function weekRangeLabel(weekStart: string): string {
  const start = parseISO(weekStart)
  const end = addDays(start, 6)
  return `${format(start, 'MMM d')} – ${format(end, 'MMM d')}`
}

export function shiftWeek(weekStart: string, weeks: number): string {
  return format(addDays(parseISO(weekStart), weeks * 7), 'yyyy-MM-dd')
}
