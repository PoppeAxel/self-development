import { supabase } from './supabase'
import { renumber, type OptionRow } from './editable'

// Reads and writes for the generic `options` table (migration 0048). Every in-app editable list
// goes through these, so archive/restore and ordering behave the same everywhere.

/** Every row (archived ones too — old data still needs their labels) of the given kinds. */
export async function loadOptions(kinds: string[]): Promise<OptionRow[]> {
  const { data } = await supabase.from('options').select('*').in('kind', kinds).order('position').throwOnError()
  return (data ?? []) as OptionRow[]
}

/** Every row of every kind — what the app loads at start into optionStore. */
export async function loadAllOptions(): Promise<OptionRow[]> {
  const { data } = await supabase.from('options').select('*').order('position').throwOnError()
  return (data ?? []) as OptionRow[]
}

/** A new stable key. Keys are never shown and never change on rename. */
export const newKey = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`

export async function insertOption(row: Pick<OptionRow, 'kind' | 'key' | 'label' | 'position'> & Partial<Pick<OptionRow, 'icon' | 'color' | 'meta'>>): Promise<OptionRow> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in.')
  const { data } = await supabase.from('options').insert({ ...row, user_id: user.id }).select().single().throwOnError()
  return data as OptionRow
}

export async function patchOption(id: string, patch: Partial<Pick<OptionRow, 'label' | 'icon' | 'color' | 'meta' | 'position' | 'archived_at'>>) {
  await supabase.from('options').update(patch).eq('id', id).throwOnError()
}

/** Renumber `ordered` 0..n and write only the rows whose position changed; returns them all renumbered. */
export async function writeOrder(ordered: OptionRow[]): Promise<OptionRow[]> {
  const { list, changed } = renumber(ordered)
  await Promise.all(changed.map((r) => patchOption(r.id, { position: r.position })))
  return list
}
