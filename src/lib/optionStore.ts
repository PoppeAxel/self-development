import { liveOptions, type OptionRow } from './editable'

// Every `options` row, loaded once when the app starts (App.tsx waits for it) and kept current by
// the edit sheets. The pure libs (food.ts, media.ts, finance.ts) read their lists from here
// instead of constants, so they stay supabase-free — check scripts call setOptionRows with a
// fixture. App.tsx subscribes, so any change re-renders the whole tree.

let rows: OptionRow[] = []
const listeners = new Set<() => void>()

export const getOptionRows = () => rows

export function setOptionRows(next: OptionRow[] | ((rows: OptionRow[]) => OptionRow[])) {
  rows = typeof next === 'function' ? next(rows) : next
  for (const l of listeners) l()
}

export function subscribeOptions(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Live rows of a kind, in order. */
export const live = (kind: string) => liveOptions(rows, kind)

/** Any row of a kind by key, archived ones included — old data still needs its label. */
export const findOption = (kind: string, key: string) => rows.find((r) => r.kind === kind && r.key === key)
