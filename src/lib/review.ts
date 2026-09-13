import { formatSleepDuration } from './sleep'
import type { WeekBucket } from './weekly'
import { byAvg, byTotal, weekAt, weekBefore, type WeekMeasure } from './weekly'

// The Weekly review's numbers and its one-sentence read of the week. Pure functions over
// buckets from src/lib/weekly.ts — no queries here, so the sentence logic stays testable
// and the view stays a view. Same rule as the maintenance estimate: only Pontus's own
// logged data, never a guess.

export type ReviewMetric = 'weight' | 'sleep' | 'steps' | 'cardio' | 'strength' | 'intake'

export interface ReviewFigure {
  metric: ReviewMetric
  label: string
  /** Formatted headline, e.g. "82.7 kg", "6h 52m", "9 140". */
  value: string
  /** Formatted change vs the week before, or null when there's nothing to compare to. */
  delta: string | null
  /** true = moved the way you'd want, false = the other way, null = no judgement. */
  good: boolean | null
  /** Shown under the value when there's no delta — the design's "kcal/day" caption. */
  caption?: string
  /** Raw change, for ranking which clause the sentence should lead with. */
  change: number | null
}

const METRIC_MEASURE: Record<ReviewMetric, WeekMeasure> = {
  weight: byAvg,
  sleep: byAvg,
  steps: byAvg,
  cardio: byTotal,
  strength: byTotal,
  intake: byAvg,
}

// Which direction counts as an improvement. Weight is deliberately absent — whether down
// is "good" depends on the goal, so the caller passes that in. Intake has no inherent
// better direction either.
const HIGHER_IS_BETTER: Partial<Record<ReviewMetric, boolean>> = {
  sleep: true,
  steps: true,
  cardio: true,
  strength: true,
}

function formatValue(metric: ReviewMetric, value: number): string {
  switch (metric) {
    case 'weight':
      return `${value.toFixed(1)} kg`
    case 'sleep':
      return formatSleepDuration(value)
    case 'steps':
      return Math.round(value).toLocaleString()
    case 'cardio':
      return `${value.toFixed(1)} km`
    case 'strength':
      return `${Math.round(value)} min`
    case 'intake':
      return Math.round(value).toLocaleString()
  }
}

function formatDelta(metric: ReviewMetric, change: number): string {
  const sign = change > 0 ? '+' : '-'
  const size = Math.abs(change)
  switch (metric) {
    case 'weight':
      return `${sign}${size.toFixed(1)} kg`
    case 'sleep':
      return `${sign}${formatSleepDuration(size)}`
    case 'steps':
      return `${sign}${Math.round(size).toLocaleString()}/day`
    case 'cardio':
      return `${sign}${size.toFixed(1)} km`
    case 'strength':
      return `${sign}${Math.round(size)} min`
    case 'intake':
      return `${sign}${Math.round(size).toLocaleString()}/day`
  }
}

/**
 * One card's worth of numbers for a metric in a given week. Returns null when that week
 * has nothing logged for it — the card is then left out rather than shown as a zero.
 */
export function reviewFigure(
  metric: ReviewMetric,
  label: string,
  buckets: WeekBucket[],
  weekStart: string,
  weightLossIsGood = true,
): ReviewFigure | null {
  const current = weekAt(buckets, weekStart)
  if (!current) return null
  const measure = METRIC_MEASURE[metric]
  const previous = weekBefore(buckets, weekStart)
  const change = previous ? measure(current) - measure(previous) : null

  let good: boolean | null = null
  if (change != null && Math.abs(change) > 0) {
    if (metric === 'weight') good = weightLossIsGood ? change < 0 : change > 0
    else if (HIGHER_IS_BETTER[metric]) good = change > 0
  }

  return {
    metric,
    label,
    value: formatValue(metric, measure(current)),
    delta: change != null ? formatDelta(metric, change) : null,
    good,
    caption: metric === 'intake' ? 'kcal/day' : undefined,
    change,
  }
}

/**
 * True when this week's move is the biggest in the trailing `window` weeks — what lets the
 * sentence say "your fastest week this month" rather than just reporting a number.
 */
function isLargestMoveRecently(buckets: WeekBucket[], weekStart: string, measure: WeekMeasure, window = 4): boolean {
  const index = buckets.findIndex((b) => b.weekStart === weekStart)
  if (index < 1) return false
  const changes: { weekStart: string; change: number }[] = []
  for (let i = Math.max(1, index - window + 1); i <= index; i++) {
    changes.push({ weekStart: buckets[i].weekStart, change: Math.abs(measure(buckets[i]) - measure(buckets[i - 1])) })
  }
  if (changes.length < 2) return false
  const best = changes.reduce((a, b) => (b.change > a.change ? b : a))
  return best.weekStart === weekStart
}

const SECONDARY_PHRASE: Record<Exclude<ReviewMetric, 'weight'>, (size: number, up: boolean) => string> = {
  sleep: (size, up) => `slept ${formatSleepDuration(size)} ${up ? 'more' : 'less'} a night`,
  steps: (size, up) => `walked ${Math.round(size).toLocaleString()} ${up ? 'more' : 'fewer'} steps a day`,
  cardio: (size, up) => `${up ? 'ran and rode' : 'covered'} ${size.toFixed(1)} km ${up ? 'more' : 'less'}`,
  strength: (size, up) => `spent ${Math.round(size)} min ${up ? 'more' : 'less'} lifting`,
  intake: (size, up) => `ate ${Math.round(size).toLocaleString()} kcal ${up ? 'more' : 'less'} a day`,
}

/** How big a change has to be before it's worth a sentence, per metric. */
const NOTABLE: Record<Exclude<ReviewMetric, 'weight'>, number> = {
  sleep: 1 / 6, // 10 minutes
  steps: 400,
  cardio: 1.5,
  strength: 15,
  intake: 150,
}

export interface WeekSentence {
  /** Plain text with `**bold**` spans the view renders as emphasis. */
  text: string
}

/**
 * The week in a sentence: what the weight did, then the single most notable other change.
 * Deliberately conservative — it only claims a superlative it can see in the data, and
 * says nothing at all when the week is too thin to compare.
 */
export function weekSentence(
  weightWeeks: WeekBucket[],
  others: { metric: Exclude<ReviewMetric, 'weight'>; buckets: WeekBucket[] }[],
  weekStart: string,
  weightLossIsGood = true,
): WeekSentence | null {
  const clauses: string[] = []

  const weightNow = weekAt(weightWeeks, weekStart)
  const weightBefore = weekBefore(weightWeeks, weekStart)
  if (weightNow && weightBefore) {
    const change = weightNow.avg - weightBefore.avg
    const size = Math.abs(change)
    if (size < 0.1) {
      clauses.push('Your weight held steady.')
    } else {
      const verb = change < 0 ? 'lost' : 'gained'
      const superlative =
        isLargestMoveRecently(weightWeeks, weekStart, byAvg) && (weightLossIsGood ? change < 0 : change > 0)
          ? ' — your biggest move this month'
          : ''
      clauses.push(`You ${verb} **${size.toFixed(1)} kg**${superlative}.`)
    }
  }

  // Pick the single most notable other change, measured against each metric's own
  // threshold so a 400-step swing doesn't outrank half an hour of extra sleep.
  let best: { metric: Exclude<ReviewMetric, 'weight'>; change: number; score: number } | null = null
  for (const { metric, buckets } of others) {
    const now = weekAt(buckets, weekStart)
    const before = weekBefore(buckets, weekStart)
    if (!now || !before) continue
    const change = METRIC_MEASURE[metric](now) - METRIC_MEASURE[metric](before)
    const score = Math.abs(change) / NOTABLE[metric]
    if (score < 1) continue
    if (!best || score > best.score) best = { metric, change, score }
  }
  if (best) {
    const phrase = SECONDARY_PHRASE[best.metric](Math.abs(best.change), best.change > 0)
    const lead = clauses.length ? 'You also' : 'You'
    clauses.push(`${lead} ${phrase} than the week before.`)
  }

  if (!clauses.length) return null
  return { text: clauses.join(' ') }
}

/**
 * Days in the week with at least one completed task per category — "5 of 7 Training days".
 * Counts distinct dates, so three Training tasks finished on one day is still one day.
 */
export function consistencyByCategory(
  completions: { task_id: string; date: string }[],
  taskCategory: Map<string, string>,
): Map<string, number> {
  const datesByCategory = new Map<string, Set<string>>()
  for (const completion of completions) {
    const categoryId = taskCategory.get(completion.task_id)
    if (!categoryId) continue
    const dates = datesByCategory.get(categoryId) ?? new Set<string>()
    dates.add(completion.date)
    datesByCategory.set(categoryId, dates)
  }
  return new Map([...datesByCategory.entries()].map(([categoryId, dates]) => [categoryId, dates.size]))
}
