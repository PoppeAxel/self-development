// Shared rules for anything edited in place (labels now; the options lists later). Pure — no
// supabase import — so scripts/editable.check.ts can run it under node.

export const MAX_NAME = 30

/** A row of the generic `options` table (migration 0048): one in-app editable list item. */
export interface OptionRow {
  id: string
  kind: string
  /** Stable id other rows store; never changes on rename. */
  key: string
  label: string
  icon: string | null
  color: string | null
  position: number
  meta: Record<string, unknown>
  /** Code logic depends on it: can be renamed, not deleted. */
  system: boolean
  archived_at: string | null
}

/** Live rows of one kind in display order. */
export const liveOptions = (rows: OptionRow[], kind: string) =>
  rows.filter((r) => r.kind === kind && !r.archived_at).sort((a, b) => a.position - b.position || a.label.localeCompare(b.label))

/** Why a name can't be saved, or null if it can. `others` = every other item's name, archived ones too. */
export function nameProblem(name: string, others: string[]): string | null {
  const n = name.trim()
  if (!n) return 'Give it a name.'
  if (n.length > MAX_NAME) return `Keep it under ${MAX_NAME} characters.`
  if (others.some((o) => o.trim().toLowerCase() === n.toLowerCase())) return 'That name is already used.'
  return null
}

/** "Work" → "Work 2" (or the first free number). */
export function copyName(name: string, taken: string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()))
  const base = name.replace(/ \d+$/, '')
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`
    if (!lower.has(candidate.toLowerCase())) return candidate
  }
}

/** Swap an item with its neighbour in `list` (already in display order). No-op at either end. */
export function moveItem<T extends { id: string }>(list: T[], id: string, dir: -1 | 1): T[] {
  const i = list.findIndex((x) => x.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/** Give every item its index as `position`; returns the list plus only the rows whose position changed. */
export function renumber<T extends { id: string; position: number }>(list: T[]): { list: T[]; changed: T[] } {
  const out = list.map((x, i) => (x.position === i ? x : { ...x, position: i }))
  return { list: out, changed: out.filter((x, i) => x !== list[i]) }
}

/** Display order: position, then name for ties (rows created before ordering existed). */
export const byPosition = <T extends { position: number; name: string }>(a: T, b: T) => a.position - b.position || a.name.localeCompare(b.name)
