import type { JournalEntryType } from './types'

// Registry of synced metrics a daily task can auto-complete against. Adding a new one
// (e.g. sleep hours) means: add it here, add its journal_entries type to the check
// constraint in a migration, and add an ingestion endpoint that writes that type —
// no further changes needed in Today's auto-complete logic, form, or display.
export const AUTO_METRICS = ['steps'] as const
export type AutoMetric = (typeof AUTO_METRICS)[number]

export const METRIC_INFO: Record<AutoMetric, { label: string; journalType: JournalEntryType; icon: string; unit: string }> = {
  steps: { label: 'Steps (Garmin)', journalType: 'steps', icon: '🚶', unit: 'steps' },
}

export function isAutoMetric(value: string | null): value is AutoMetric {
  return value != null && (AUTO_METRICS as readonly string[]).includes(value)
}
