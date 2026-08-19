import { supabase } from './supabase'
import type { JournalEntryType } from './types'

// Registry of synced metrics a daily task can auto-complete against. Adding a new one
// (e.g. sleep hours) means: add it here, add its journal_entries type to the check
// constraint in a migration, and add an ingestion endpoint that writes that type —
// no further changes needed in Today's auto-complete logic, form, or display.
export const AUTO_METRICS = ['steps', 'sleep_hours', 'cardio_minutes', 'strength_minutes'] as const
export type AutoMetric = (typeof AUTO_METRICS)[number]

export const METRIC_INFO: Record<AutoMetric, { label: string; journalType: JournalEntryType; icon: string; unit: string }> = {
  steps: { label: 'Steps (Garmin)', journalType: 'steps', icon: '🚶', unit: 'steps' },
  sleep_hours: { label: 'Sleep (hours)', journalType: 'sleep_hours', icon: '😴', unit: 'hours' },
  cardio_minutes: { label: 'Cardio (Strava)', journalType: 'cardio_minutes', icon: '🏃', unit: 'min' },
  strength_minutes: { label: 'Strength (Strava)', journalType: 'strength_minutes', icon: '🏋️', unit: 'min' },
}

export function isAutoMetric(value: string | null): value is AutoMetric {
  return value != null && (AUTO_METRICS as readonly string[]).includes(value)
}

// Manually set a synced metric's value for a given day, e.g. when Garmin/phone
// failed to record steps. Upserts by (type, date), same shape as the auto sync
// writes, so it flows through the normal auto-complete + Stats logic afterward.
export async function upsertMetricValue(metric: AutoMetric, date: string, value: number) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  const journalType = METRIC_INFO[metric].journalType
  const { data: existing } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('type', journalType)
    .eq('date', date)
    .maybeSingle()
  if (existing) {
    await supabase.from('journal_entries').update({ value_numeric: value }).eq('id', existing.id)
  } else {
    await supabase.from('journal_entries').insert({
      type: journalType,
      value_numeric: value,
      value_text: null,
      date,
      user_id: user.id,
    })
  }
}
