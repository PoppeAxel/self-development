import { useState } from 'react'
import { CATEGORY_COLOR_LABELS, CATEGORY_STYLES } from '../lib/categories'
import { copyName, liveOptions, moveItem, nameProblem, type OptionRow } from '../lib/editable'
import { insertOption, newKey, patchOption, writeOrder } from '../lib/options'
import { getOptionRows, setOptionRows } from '../lib/optionStore'
import { CATEGORY_COLORS } from '../lib/types'
import { useEdit } from '../contexts/EditContext'
import { ConfirmDialog } from './ConfirmDialog'
import { ItemSheet } from './ItemMenu'

// The edit sheet for any simple `options` list kept in optionStore (meal types, media kinds,
// savings accounts, ingredient categories): icon, name, colour, the kind's own extra fields,
// then Duplicate / ↑ / ↓ / Delete. Deleting an item something still uses asks where those rows
// go (`refs`), then archives it with Undo. System rows (code depends on them) can't be deleted.

/** How rows elsewhere point at an item — so a delete can move them, and Undo move them back. */
export interface RefMover {
  /** "3 entries", "1 ingredient". */
  noun: (n: number) => string
  /** The value other rows store for this item: its key, or its label (ingredient categories). */
  valueOf: (row: OptionRow) => string
  /** Ids of the rows that store `value`. */
  find: (value: string) => Promise<string[]>
  /** Point those rows at `to` (null = none). */
  move: (ids: string[], to: string | null) => Promise<void>
  /** Offer "none" as a target, with this label. */
  noneLabel?: string
}

const FIELD = 'rounded-[14px] border border-line bg-page px-3 py-2.5 text-sm font-medium text-ink outline-none placeholder:text-ink-faint focus:border-pine'

const replaceRows = (all: OptionRow[], changed: OptionRow[]) => {
  const byId = new Map(changed.map((r) => [r.id, r]))
  return all.map((r) => byId.get(r.id) ?? r)
}

export function OptionSheet({
  kind,
  row,
  noun,
  onClose,
  color,
  fields,
  newMeta = {},
  refs,
  onRenamed,
  onChanged,
}: {
  kind: string
  /** null = create a new one. */
  row: OptionRow | null
  /** "meal", "account" — used in titles and messages. */
  noun: string
  onClose: () => void
  /** 'palette' = the six category colours (stored by name), 'hex' = a free colour. Omit for none. */
  color?: 'palette' | 'hex'
  /** The kind's own fields, editing `meta`. */
  fields?: (meta: Record<string, unknown>, set: (patch: Record<string, unknown>) => void) => React.ReactNode
  newMeta?: Record<string, unknown>
  refs?: RefMover
  /** After the name changed (ingredient categories rewrite the rows that store the old one). */
  onRenamed?: (from: string, to: string) => Promise<void>
  /** Rows elsewhere changed (moved by a delete or its undo, or renamed) — reload what shows them. */
  onChanged?: () => void
}) {
  const { offerUndo } = useEdit()
  const items = liveOptions(getOptionRows(), kind)
  const index = row ? items.findIndex((r) => r.id === row.id) : -1
  const [label, setLabel] = useState(row?.label ?? '')
  const [icon, setIcon] = useState(row?.icon ?? '')
  // New items default to a colour nothing uses yet (palette) or the last item's (hex).
  const freePalette = CATEGORY_COLORS.find((c) => !items.some((r) => r.color === c)) ?? CATEGORY_COLORS[0]
  const [colour, setColour] = useState<string>(row?.color ?? (color === 'palette' ? freePalette : (items.at(-1)?.color ?? '#8b8577')))
  const [meta, setMeta] = useState<Record<string, unknown>>(row?.meta ?? newMeta)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moving, setMoving] = useState<string[] | null>(null)
  const [moveTo, setMoveTo] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(async () => {
      const problem = nameProblem(label, items.filter((r) => r.id !== row?.id).map((r) => r.label))
      if (problem) return setError(problem)
      // meta.tint is a fixed companion of the colour (seeded ingredient categories): a new colour
      // drops it so the tint is mixed from the new colour instead of staying the old hue.
      const { tint: _tint, ...rest } = meta
      const keepMeta = !row || colour === row.color || !('tint' in meta)
      const patch = { label: label.trim(), icon: icon.trim() || null, color: color ? colour : null, meta: keepMeta ? meta : rest }
      if (row) {
        await patchOption(row.id, patch)
        setOptionRows((all) => all.map((r) => (r.id === row.id ? { ...r, ...patch } : r)))
        if (patch.label !== row.label && onRenamed) {
          await onRenamed(row.label, patch.label)
          onChanged?.()
        }
      } else {
        const created = await insertOption({ kind, key: newKey(kind), position: items.length, ...patch })
        setOptionRows((all) => [...all, created])
      }
      onClose()
    })

  const duplicate = () =>
    run(async () => {
      if (!row) return
      const created = await insertOption({ kind, key: newKey(kind), label: copyName(row.label, items.map((r) => r.label)), icon: row.icon, color: row.color, meta: row.meta, position: row.position })
      const ordered = [...items]
      ordered.splice(index + 1, 0, created)
      const list = await writeOrder(ordered)
      setOptionRows((all) => replaceRows([...all, created], list))
      onClose()
    })

  const move = (dir: -1 | 1) =>
    run(async () => {
      if (!row) return
      const list = await writeOrder(moveItem(items, row.id, dir))
      setOptionRows((all) => replaceRows(all, list))
    })

  const startDelete = () =>
    run(async () => {
      if (!row) return
      const ids = refs ? await refs.find(refs.valueOf(row)) : []
      if (ids.length === 0) return setConfirm(true)
      const other = items.find((r) => r.id !== row.id)
      setMoveTo(refs?.noneLabel ? null : other && refs ? refs.valueOf(other) : null)
      setMoving(ids)
    })

  const doDelete = () =>
    run(async () => {
      if (!row) return
      const ids = moving ?? []
      if (ids.length && refs) await refs.move(ids, moveTo)
      const archivedAt = new Date().toISOString()
      await patchOption(row.id, { archived_at: archivedAt })
      setOptionRows((all) => all.map((r) => (r.id === row.id ? { ...r, archived_at: archivedAt } : r)))
      onClose()
      if (ids.length) onChanged?.()
      offerUndo(`Deleted “${row.label}”`, async () => {
        await patchOption(row.id, { archived_at: null })
        if (ids.length && refs) await refs.move(ids, refs.valueOf(row))
        setOptionRows((all) => all.map((r) => (r.id === row.id ? { ...r, archived_at: null } : r)))
        if (ids.length) onChanged?.()
      })
    })

  const targets = refs && row ? items.filter((r) => r.id !== row.id) : []

  return (
    <>
      <ItemSheet
        title={row ? `Edit ${noun}` : `New ${noun}`}
        onClose={onClose}
        onDuplicate={row && !moving ? duplicate : undefined}
        onMoveUp={row && !moving && index > 0 ? () => move(-1) : undefined}
        onMoveDown={row && !moving && index < items.length - 1 ? () => move(1) : undefined}
        onDelete={row && !moving && !row.system ? startDelete : undefined}
      >
        {moving && row && refs ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-2">
              {refs.noun(moving.length)} {moving.length === 1 ? 'uses' : 'use'} “{row.label}”. Move {moving.length === 1 ? 'it' : 'them'} to:
            </p>
            <div className="flex flex-wrap gap-[7px]">
              {[...(refs.noneLabel ? [{ value: null as string | null, label: refs.noneLabel }] : []), ...targets.map((r) => ({ value: refs.valueOf(r) as string | null, label: `${r.icon ?? ''} ${r.label}`.trim() }))].map((t) => (
                <button
                  key={t.value ?? '__none'}
                  type="button"
                  onClick={() => setMoveTo(t.value)}
                  className={`rounded-full px-3 py-1.5 text-xs ${moveTo === t.value ? 'bg-pine font-semibold text-white' : 'border border-line bg-surface font-medium text-ink-2'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {error && <p className="text-xs font-medium text-cat-rose-ink">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setMoving(null)} className="flex-1 rounded-[20px] bg-track px-4 py-2.5 text-sm font-medium text-ink-2">
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={doDelete} className="flex-1 rounded-[20px] bg-cat-rose px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                Move and delete
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} placeholder="🏷" aria-label="Icon" className={`${FIELD} w-14 text-center`} />
              <input
                autoFocus={!row}
                value={label}
                maxLength={30}
                onChange={(e) => {
                  setLabel(e.target.value)
                  setError(null)
                }}
                placeholder="Name"
                aria-label="Name"
                className={`${FIELD} min-w-0 flex-1`}
              />
              {color === 'hex' && (
                <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} aria-label="Colour" className="h-[42px] w-11 shrink-0 cursor-pointer rounded-[14px] border border-line bg-page p-1" />
              )}
            </div>
            {color === 'palette' && (
              <div className="flex items-center gap-2.5">
                {CATEGORY_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColour(c)}
                    aria-label={CATEGORY_COLOR_LABELS[c]}
                    aria-pressed={colour === c}
                    className={`h-7 w-7 rounded-full ${colour === c ? 'ring-2 ring-ink ring-offset-2' : ''}`}
                    style={{ background: CATEGORY_STYLES[c].accent }}
                  />
                ))}
              </div>
            )}
            {fields?.(meta, (patch) => setMeta((m) => ({ ...m, ...patch })))}
            {row?.system && <p className="text-[11px] text-ink-muted">The app’s maths depends on this one, so it can be renamed but not deleted.</p>}
            {error && <p className="text-xs font-medium text-cat-rose-ink">{error}</p>}
            <button type="button" disabled={busy} onClick={save} className="rounded-[20px] bg-pine px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {row ? 'Save' : `Add ${noun}`}
            </button>
          </div>
        )}
      </ItemSheet>
      <ConfirmDialog
        open={confirm}
        title={`Delete “${row?.label}”?`}
        message="Nothing uses it. You can undo for a few seconds."
        confirmLabel="Delete"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          doDelete()
        }}
      />
    </>
  )
}
