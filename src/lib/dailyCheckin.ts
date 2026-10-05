// Daily check-in: six fixed 1–10 evening ratings + optional note (daily_checkins), opened
// from the button at the top of Today. Not to be confused with checkins.ts (goal
// check-ups). Pure — no supabase import. Every scale reads "10 = good" (stress is asked as
// "calm") so the numbers compare across categories.
import { format, subDays } from 'date-fns'
import type { CategoryColor } from './types'

export const CHECKIN_KEYS = ['mood', 'energy', 'calm', 'focus', 'connection', 'body'] as const
export type CheckinKey = (typeof CHECKIN_KEYS)[number]

export const CHECKIN_INFO: Record<CheckinKey, { label: string; question: string; low: string; high: string }> = {
  mood: { label: 'Mood', question: 'How good did today feel overall?', low: 'Awful', high: 'Great' },
  energy: { label: 'Energy', question: 'How much energy did you have?', low: 'Drained', high: 'Energised' },
  calm: { label: 'Calm', question: 'How calm did you feel?', low: 'Stressed', high: 'Calm' },
  focus: { label: 'Focus', question: 'Did you spend your time on what mattered?', low: 'Scattered', high: 'Focused' },
  connection: { label: 'Connection', question: 'How connected did you feel to others?', low: 'Lonely', high: 'Connected' },
  body: { label: 'Body', question: 'How did your body feel?', low: 'Beat up', high: 'Fresh' },
}

export type DailyCheckin = { id: string; date: string; note: string | null } & Record<CheckinKey, number | null>

// Checking in after midnight still belongs to the day you're reflecting on.
export function checkinDateISO(now: Date = new Date()): string {
  return format(now.getHours() < 4 ? subDays(now, 1) : now, 'yyyy-MM-dd')
}

/** The word shown beside a slider value: the category's own words at the ends, plain ones between. */
export function descriptor(key: CheckinKey, v: number): string {
  if (v <= 2) return CHECKIN_INFO[key].low
  if (v <= 4) return 'Below par'
  if (v <= 6) return 'Okay'
  if (v <= 8) return 'Good'
  return CHECKIN_INFO[key].high
}

/**
 * The read-back's one-line summary: each score against its average over the 7 days before.
 * `previous` should already be limited to those days. Null when there's nothing to compare.
 */
export function headline(day: Record<CheckinKey, number | null>, previous: Record<CheckinKey, number | null>[]): string | null {
  const diffs: { key: CheckinKey; diff: number }[] = []
  for (const key of CHECKIN_KEYS) {
    const v = day[key]
    const past = previous.map((p) => p[key]).filter((x): x is number => x != null)
    if (v == null || past.length === 0) continue
    diffs.push({ key, diff: v - past.reduce((s, x) => s + x, 0) / past.length })
  }
  if (diffs.length === 0) return null
  diffs.sort((a, b) => b.diff - a.diff)
  const best = diffs[0]
  const worst = diffs[diffs.length - 1]
  const label = (k: CheckinKey) => CHECKIN_INFO[k].label
  if (diffs.every((d) => Math.abs(d.diff) < 0.5)) return 'A pretty typical day — right on your weekly average.'
  if (worst.diff > -0.5) return `${label(best.key)} stood out — above your week.`
  // Nothing was up, something was down — "X was up" would be false.
  if (best.diff < 0.5) return `${label(worst.key)} dipped below your week.`
  return `${label(best.key)} was up, ${label(worst.key)} dipped.`
}

// ------------------------------------------------------------------ the diary's timeline

export type MomentSource = 'task' | 'workout' | 'gym' | 'food' | 'sleep' | 'weight' | 'steps'

/** One row of "Your day". `time` is local HH:mm, or null for things with no time of day. */
export interface Moment {
  source: MomentSource
  /** '' for once-a-day sources, the meal type for food, else the source row's id. */
  sourceId: string
  time: string | null
  icon: string
  title: string
  meta: string
}

export const MOMENT_COLOR: Record<MomentSource, CategoryColor> = {
  sleep: 'violet',
  weight: 'sky',
  task: 'amber',
  workout: 'emerald',
  gym: 'pink',
  food: 'rose',
  steps: 'emerald',
}

export const momentKey = (m: { source: MomentSource; sourceId: string }) => `${m.source}:${m.sourceId}`

/** Timed moments in time order, then the untimed ones (steps, Strava workouts) as "Today". */
export function sortMoments(moments: Moment[]): Moment[] {
  return [...moments].sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'))
}
