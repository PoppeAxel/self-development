import { formatSleepDuration } from './sleep'
import { byAvg, byTotal, type WeekBucket, type WeekMeasure } from './weekly'

// "What actually moves the needle" — two metrics on one weekly axis, described in plain
// language rather than a correlation coefficient. Same principle as the maintenance
// estimate: only Pontus's own logs, and no claim the data doesn't support.

export type InsightMetric = 'weight' | 'sleep' | 'steps' | 'cardio' | 'strength' | 'intake'

export const INSIGHT_METRICS: InsightMetric[] = ['weight', 'sleep', 'steps', 'cardio', 'strength', 'intake']

interface MetricSpec {
  label: string
  /** Short axis/legend unit. */
  unit: string
  measure: WeekMeasure
  format: (value: number) => string
  /** "slept", "walked" — used to build the threshold sentence. */
  verb: string
  /** What a difference in this metric is counted in, e.g. "steps a day". */
  per: string
}

export const INSIGHT_SPEC: Record<InsightMetric, MetricSpec> = {
  weight: { label: 'Weight', unit: 'kg', measure: byAvg, format: (v) => `${v.toFixed(1)} kg`, verb: 'weighed', per: 'kg' },
  sleep: { label: 'Sleep', unit: 'h', measure: byAvg, format: formatSleepDuration, verb: 'slept', per: 'a night' },
  steps: {
    label: 'Steps',
    unit: 'steps/day',
    measure: byAvg,
    format: (v) => Math.round(v).toLocaleString(),
    verb: 'walked',
    per: 'steps a day',
  },
  cardio: { label: 'Cardio', unit: 'km', measure: byTotal, format: (v) => `${v.toFixed(1)} km`, verb: 'covered', per: 'km' },
  strength: {
    label: 'Strength',
    unit: 'min',
    measure: byTotal,
    format: (v) => `${Math.round(v)} min`,
    verb: 'trained',
    per: 'min',
  },
  intake: {
    label: 'Intake',
    unit: 'kcal/day',
    measure: byAvg,
    format: (v) => `${Math.round(v).toLocaleString()} kcal`,
    verb: 'ate',
    per: 'kcal a day',
  },
}

export interface PairedWeek {
  weekStart: string
  a: number
  b: number
}

/** Weeks where both metrics have data, oldest first — the only weeks worth comparing. */
export function alignWeeks(a: WeekBucket[], b: WeekBucket[], metricA: InsightMetric, metricB: InsightMetric, limit = 12): PairedWeek[] {
  const bByWeek = new Map(b.map((bucket) => [bucket.weekStart, bucket]))
  return a
    .filter((bucket) => bByWeek.has(bucket.weekStart))
    .map((bucket) => ({
      weekStart: bucket.weekStart,
      a: INSIGHT_SPEC[metricA].measure(bucket),
      b: INSIGHT_SPEC[metricB].measure(bByWeek.get(bucket.weekStart)!),
    }))
    .slice(-limit)
}

export interface Agreement {
  /** Week-to-week moves compared (one fewer than the number of weeks). */
  compared: number
  /** How many of those moves went the same way in both metrics. */
  agree: number
  label: 'Moves together' | 'Moves opposite' | 'No clear pattern'
}

/**
 * How often the two metrics move the same direction week to week. Deliberately not a
 * correlation coefficient — this is a count you can check by eye against the chart.
 */
export function agreement(pairs: PairedWeek[]): Agreement | null {
  if (pairs.length < 3) return null
  let compared = 0
  let agree = 0
  for (let i = 1; i < pairs.length; i++) {
    const da = pairs[i].a - pairs[i - 1].a
    const db = pairs[i].b - pairs[i - 1].b
    // A flat week says nothing about direction, so it isn't counted either way.
    if (da === 0 || db === 0) continue
    compared += 1
    if (da > 0 === db > 0) agree += 1
  }
  if (compared < 3) return null
  const ratio = agree / compared
  return {
    compared,
    agree,
    label: ratio >= 0.65 ? 'Moves together' : ratio <= 0.35 ? 'Moves opposite' : 'No clear pattern',
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * The headline finding: split the weeks at metric A's median and compare what metric B
 * averaged on each side. Returns null when there aren't enough weeks, when either side is
 * empty, or when the gap is too small to be worth a sentence — better to say nothing than
 * to dress noise up as a finding. `**bold**` spans are rendered by the view.
 */
export function thresholdFinding(pairs: PairedWeek[], metricA: InsightMetric, metricB: InsightMetric): string | null {
  if (pairs.length < 4) return null
  const specA = INSIGHT_SPEC[metricA]
  const specB = INSIGHT_SPEC[metricB]
  const cut = median(pairs.map((p) => p.a))

  const high = pairs.filter((p) => p.a >= cut)
  const low = pairs.filter((p) => p.a < cut)
  if (high.length === 0 || low.length === 0) return null

  const mean = (rows: PairedWeek[]) => rows.reduce((sum, r) => sum + r.b, 0) / rows.length
  const diff = mean(high) - mean(low)

  // Needs to be at least a tenth of the low group's level to count as a real gap.
  const base = Math.abs(mean(low))
  if (base > 0 && Math.abs(diff) / base < 0.1) return null
  if (base === 0 && diff === 0) return null

  const direction = diff > 0 ? 'more' : 'fewer'
  return `Weeks you ${specA.verb} **${specA.format(cut)} or more** averaged **${specB.format(Math.abs(diff))} ${direction}** ${specB.per}.`
}

/** The pairings worth offering as one tap, in the order the design lists them. */
export const SUGGESTED_PAIRINGS: { a: InsightMetric; b: InsightMetric }[] = [
  { a: 'intake', b: 'weight' },
  { a: 'cardio', b: 'weight' },
  { a: 'steps', b: 'intake' },
  { a: 'strength', b: 'sleep' },
]
