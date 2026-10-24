// Daily check-in: 1–10 evening ratings + optional note (daily_checkins), opened from the button
// at the top of Today. Not to be confused with checkins.ts (goal check-ups). Pure — no supabase
// import. The questions are `options` rows (kind 'checkin_question', meta {question, low, high};
// migration 0050), edited in place in the check-in; every scale reads "10 = good" (stress is
// asked as "calm") so the numbers compare across questions.
import { format, subDays } from 'date-fns'
import { findOption, live } from './optionStore'
import type { OptionRow } from './editable'
import type { CategoryColor } from './types'

/** A checkin_question key — also the key in daily_checkins.scores. */
export type CheckinKey = string

export interface QuestionInfo {
  key: CheckinKey
  label: string
  question: string
  low: string
  high: string
}

const toQuestion = (r: OptionRow): QuestionInfo => ({
  key: r.key,
  label: r.label,
  question: String(r.meta.question ?? ''),
  low: String(r.meta.low || 'Low'),
  high: String(r.meta.high || 'High'),
})

/** Live questions, in order. */
export const checkinQuestions = (): QuestionInfo[] => live('checkin_question').map(toQuestion)

/** Any question by key (archived too); an unknown key reads as itself. */
export const questionInfo = (key: CheckinKey): QuestionInfo => {
  const r = findOption('checkin_question', key)
  return r ? toQuestion(r) : { key, label: key, question: '', low: 'Low', high: 'High' }
}

/** The diary's prompt chips, in order. */
export const diaryPrompts = (): string[] => live('diary_prompt').map((r) => r.label)

export type Scores = Record<CheckinKey, number | null>

/** A daily_checkins row. Scores of a question deleted since stay in `scores` (history). */
export interface DailyCheckin {
  id: string
  date: string
  note: string | null
  scores: Scores
}

// Checking in after midnight still belongs to the day you're reflecting on.
export function checkinDateISO(now: Date = new Date()): string {
  return format(now.getHours() < 4 ? subDays(now, 1) : now, 'yyyy-MM-dd')
}

/** The word shown beside a slider value: the category's own words at the ends, plain ones between. */
export function descriptor(key: CheckinKey, v: number): string {
  if (v <= 2) return questionInfo(key).low
  if (v <= 4) return 'Below par'
  if (v <= 6) return 'Okay'
  if (v <= 8) return 'Good'
  return questionInfo(key).high
}

/**
 * The read-back's one-line summary: each score against its average over the 7 days before.
 * `previous` should already be limited to those days. Null when there's nothing to compare.
 */
export function headline(day: Scores, previous: Scores[]): string | null {
  const diffs: { key: CheckinKey; diff: number }[] = []
  for (const { key } of checkinQuestions()) {
    const v = day[key]
    const past = previous.map((p) => p[key]).filter((x): x is number => x != null)
    if (v == null || past.length === 0) continue
    diffs.push({ key, diff: v - past.reduce((s, x) => s + x, 0) / past.length })
  }
  if (diffs.length === 0) return null
  diffs.sort((a, b) => b.diff - a.diff)
  const best = diffs[0]
  const worst = diffs[diffs.length - 1]
  const label = (k: CheckinKey) => questionInfo(k).label
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
