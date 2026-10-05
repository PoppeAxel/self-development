// Daily check-in: six fixed 1–10 evening ratings + optional note (daily_checkins), opened
// from the button at the top of Today. Not to be confused with checkins.ts (goal
// check-ups). Pure — no supabase import. Every scale reads "10 = good" (stress is asked as
// "calm") so the numbers compare across categories.
import { format, subDays } from 'date-fns'

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
