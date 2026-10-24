import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { copyName, liveOptions, moveItem, nameProblem, type OptionRow } from '../lib/editable'
import { insertOption, newKey, patchOption, writeOrder } from '../lib/options'
import { SPECIAL_INFO, safeRegExp, type SpecialCategory } from '../lib/budget'
import { useEdit } from '../contexts/EditContext'
import { ConfirmDialog } from './ConfirmDialog'
import { ItemSheet } from './ItemMenu'

// Economy → Budget/Plan: the sheets behind each head category's and subcategory's ⋯ (edit mode
// or long-press), and the keyword list that guesses a category on import. All rows live in
// `options` (budget_head / budget_sub / budget_keyword); a transaction stores the sub's key, so
// renaming never touches transactions. Deleting archives, with Undo; a used sub asks where its
// transactions go, a head with subs asks where the subs go.

type SetOptions = React.Dispatch<React.SetStateAction<OptionRow[]>>

interface Shared {
  options: OptionRow[]
  setOptions: SetOptions
  onClose: () => void
  /** Transactions were moved to another category (delete or its undo) — reload them. */
  onRefsChanged: () => void
}

const FIELD = 'rounded-[14px] border border-line bg-page px-3 py-2.5 text-sm font-medium text-ink outline-none placeholder:text-ink-faint focus:border-pine'
const PRIMARY = 'rounded-[20px] bg-pine px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50'
const LABEL = 'text-[11px] font-semibold tracking-[0.06em] text-ink-3'

/** busy + error around an async action, so every sheet reports failures the same way. */
function useRun() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  return { busy, error, setError, run }
}

const replaceRows = (all: OptionRow[], changed: OptionRow[]) => {
  const byId = new Map(changed.map((r) => [r.id, r]))
  return all.map((r) => byId.get(r.id) ?? r)
}

function Chips({ items, value, onChange }: { items: { key: string; label: string }[]; value: string; onChange: (key: string) => void }) {
  return (
    <div className="flex flex-wrap gap-[7px]">
      {items.map((i) => (
        <button
          key={i.key}
          type="button"
          onClick={() => onChange(i.key)}
          className={`rounded-full px-3 py-1.5 text-xs ${value === i.key ? 'bg-pine font-semibold text-white' : 'border border-line bg-surface font-medium text-ink-2'}`}
        >
          {i.label}
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------------------ head category

export function HeadSheet({ head, options, setOptions, onClose, onRefsChanged }: Shared & { head: OptionRow | null }) {
  const { offerUndo } = useEdit()
  const heads = liveOptions(options, 'budget_head')
  const [label, setLabel] = useState(head?.label ?? '')
  const [icon, setIcon] = useState(head?.icon ?? '')
  // A new head starts with the last head's colour — change it with the picker.
  const [color, setColor] = useState(head?.color ?? heads.at(-1)?.color ?? '#8c8577')
  const { busy, error, setError, run } = useRun()
  const [moving, setMoving] = useState<OptionRow[] | null>(null)
  const [moveTo, setMoveTo] = useState('')
  const [confirm, setConfirm] = useState(false)
  const index = head ? heads.findIndex((h) => h.id === head.id) : -1

  const save = () =>
    run(async () => {
      const problem = nameProblem(label, heads.filter((h) => h.id !== head?.id).map((h) => h.label))
      if (problem) return setError(problem)
      const patch = { label: label.trim(), icon: icon.trim() || null, color }
      if (head) {
        await patchOption(head.id, patch)
        setOptions((all) => all.map((r) => (r.id === head.id ? { ...r, ...patch } : r)))
      } else {
        const created = await insertOption({ kind: 'budget_head', key: newKey('head'), position: heads.length, ...patch })
        setOptions((all) => [...all, created])
      }
      onClose()
    })

  const duplicate = () =>
    run(async () => {
      if (!head) return
      const created = await insertOption({ kind: 'budget_head', key: newKey('head'), label: copyName(head.label, heads.map((h) => h.label)), icon: head.icon, color: head.color, position: head.position })
      const ordered = [...heads]
      ordered.splice(index + 1, 0, created)
      const list = await writeOrder(ordered)
      setOptions((all) => replaceRows([...all, created], list))
      onClose()
    })

  const move = (dir: -1 | 1) =>
    run(async () => {
      if (!head) return
      const list = await writeOrder(moveItem(heads, head.id, dir))
      setOptions((all) => replaceRows(all, list))
    })

  const startDelete = () => {
    if (!head) return
    const subs = liveOptions(options, 'budget_sub').filter((s) => s.meta.head === head.key)
    if (subs.length === 0) return setConfirm(true)
    setMoveTo(heads.find((h) => h.id !== head.id)?.key ?? '')
    setMoving(subs)
  }

  const doDelete = () =>
    run(async () => {
      if (!head) return
      const subs = moving ?? []
      if (subs.length && !moveTo) return setError('Pick where its subcategories go.')
      await Promise.all(subs.map((s) => patchOption(s.id, { meta: { ...s.meta, head: moveTo } })))
      const archivedAt = new Date().toISOString()
      await patchOption(head.id, { archived_at: archivedAt })
      const moved = new Set(subs.map((s) => s.id))
      setOptions((all) => all.map((r) => (r.id === head.id ? { ...r, archived_at: archivedAt } : moved.has(r.id) ? { ...r, meta: { ...r.meta, head: moveTo } } : r)))
      onClose()
      offerUndo(`Deleted “${head.label}”`, async () => {
        await patchOption(head.id, { archived_at: null })
        await Promise.all(subs.map((s) => patchOption(s.id, { meta: s.meta })))
        const before = new Map(subs.map((s) => [s.id, s.meta]))
        setOptions((all) => all.map((r) => (r.id === head.id ? { ...r, archived_at: null } : before.has(r.id) ? { ...r, meta: before.get(r.id)! } : r)))
        onRefsChanged()
      })
    })

  return (
    <>
      <ItemSheet
        title={head ? 'Edit category' : 'New category'}
        onClose={onClose}
        onDuplicate={head && !moving ? duplicate : undefined}
        onMoveUp={head && !moving && index > 0 ? () => move(-1) : undefined}
        onMoveDown={head && !moving && index < heads.length - 1 ? () => move(1) : undefined}
        onDelete={head && !moving ? startDelete : undefined}
      >
        {moving && head ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-2">
              “{head.label}” holds {moving.length} {moving.length === 1 ? 'subcategory' : 'subcategories'} ({moving.map((s) => s.label).join(', ')}). Move them to:
            </p>
            <Chips items={heads.filter((h) => h.id !== head.id).map((h) => ({ key: h.key, label: `${h.icon ?? ''} ${h.label}` }))} value={moveTo} onChange={setMoveTo} />
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
                autoFocus={!head}
                value={label}
                maxLength={30}
                onChange={(e) => {
                  setLabel(e.target.value)
                  setError(null)
                }}
                placeholder="Category name"
                className={`${FIELD} min-w-0 flex-1`}
              />
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Colour" className="h-[42px] w-11 shrink-0 cursor-pointer rounded-[14px] border border-line bg-page p-1" />
            </div>
            {error && <p className="text-xs font-medium text-cat-rose-ink">{error}</p>}
            <button type="button" disabled={busy} onClick={save} className={PRIMARY}>
              {head ? 'Save' : 'Add category'}
            </button>
          </div>
        )}
      </ItemSheet>
      <ConfirmDialog
        open={confirm}
        title={`Delete “${head?.label}”?`}
        message="It has no subcategories. You can undo for a few seconds."
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

// ------------------------------------------------------------------------------ subcategory

export function SubSheet({ sub, headKey, options, setOptions, onClose, onRefsChanged }: Shared & { sub: OptionRow | null; headKey: string }) {
  const { offerUndo } = useEdit()
  const heads = liveOptions(options, 'budget_head')
  const allSubs = liveOptions(options, 'budget_sub')
  const [label, setLabel] = useState(sub?.label ?? '')
  const [head, setHead] = useState(String(sub?.meta.head ?? headKey))
  const [group, setGroup] = useState(sub?.meta.group === 'fixed' ? 'fixed' : 'variable')
  const { busy, error, setError, run } = useRun()
  const [txIds, setTxIds] = useState<string[] | null>(null)
  const [moveTo, setMoveTo] = useState('')
  const [confirm, setConfirm] = useState(false)
  const siblings = allSubs.filter((s) => s.meta.head === (sub?.meta.head ?? headKey))
  const index = sub ? siblings.findIndex((s) => s.id === sub.id) : -1

  const save = () =>
    run(async () => {
      const problem = nameProblem(label, allSubs.filter((s) => s.id !== sub?.id).map((s) => s.label))
      if (problem) return setError(problem)
      const inHead = allSubs.filter((s) => s.meta.head === head && s.id !== sub?.id).length
      if (sub) {
        const patch = { label: label.trim(), meta: { ...sub.meta, head, group }, ...(head !== sub.meta.head ? { position: inHead } : {}) }
        await patchOption(sub.id, patch)
        setOptions((all) => all.map((r) => (r.id === sub.id ? { ...r, ...patch } : r)))
      } else {
        const created = await insertOption({ kind: 'budget_sub', key: newKey('sub'), label: label.trim(), position: inHead, meta: { head, group } })
        setOptions((all) => [...all, created])
      }
      onClose()
    })

  const duplicate = () =>
    run(async () => {
      if (!sub) return
      const created = await insertOption({ kind: 'budget_sub', key: newKey('sub'), label: copyName(sub.label, allSubs.map((s) => s.label)), position: sub.position, meta: sub.meta })
      const ordered = [...siblings]
      ordered.splice(index + 1, 0, created)
      const list = await writeOrder(ordered)
      setOptions((all) => replaceRows([...all, created], list))
      onClose()
    })

  const move = (dir: -1 | 1) =>
    run(async () => {
      if (!sub) return
      const list = await writeOrder(moveItem(siblings, sub.id, dir))
      setOptions((all) => replaceRows(all, list))
    })

  const startDelete = () =>
    run(async () => {
      if (!sub) return
      const { data } = await supabase.from('bank_transactions').select('id').eq('category', sub.key).throwOnError()
      const ids = (data ?? []).map((r) => r.id as string)
      if (ids.length === 0) return setConfirm(true)
      setMoveTo(allSubs.find((s) => s.key === 'other')?.key ?? '')
      setTxIds(ids)
    })

  const doDelete = () =>
    run(async () => {
      if (!sub) return
      const ids = txIds ?? []
      if (ids.length && !moveTo) return setError('Pick where its transactions go.')
      if (ids.length) await supabase.from('bank_transactions').update({ category: moveTo }).in('id', ids).throwOnError()
      const archivedAt = new Date().toISOString()
      await patchOption(sub.id, { archived_at: archivedAt })
      setOptions((all) => all.map((r) => (r.id === sub.id ? { ...r, archived_at: archivedAt } : r)))
      onClose()
      if (ids.length) onRefsChanged()
      offerUndo(`Deleted “${sub.label}”`, async () => {
        await patchOption(sub.id, { archived_at: null })
        if (ids.length) await supabase.from('bank_transactions').update({ category: sub.key }).in('id', ids).throwOnError()
        setOptions((all) => all.map((r) => (r.id === sub.id ? { ...r, archived_at: null } : r)))
        if (ids.length) onRefsChanged()
      })
    })

  return (
    <>
      <ItemSheet
        title={sub ? 'Edit subcategory' : 'New subcategory'}
        onClose={onClose}
        onDuplicate={sub && !txIds ? duplicate : undefined}
        onMoveUp={sub && !txIds && index > 0 ? () => move(-1) : undefined}
        onMoveDown={sub && !txIds && index < siblings.length - 1 ? () => move(1) : undefined}
        // System subs carry logic (mortgage interest/amortization, the Other fallback).
        onDelete={sub && !txIds && !sub.system ? startDelete : undefined}
      >
        {txIds && sub ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-2">
              {txIds.length} {txIds.length === 1 ? 'transaction is' : 'transactions are'} in “{sub.label}”. Move them to:
            </p>
            <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={FIELD}>
              {heads.map((h) => (
                <optgroup key={h.key} label={`${h.icon ?? ''} ${h.label}`}>
                  {allSubs
                    .filter((s) => s.meta.head === h.key && s.id !== sub.id)
                    .map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            {error && <p className="text-xs font-medium text-cat-rose-ink">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setTxIds(null)} className="flex-1 rounded-[20px] bg-track px-4 py-2.5 text-sm font-medium text-ink-2">
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={doDelete} className="flex-1 rounded-[20px] bg-cat-rose px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                Move and delete
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <input
              autoFocus={!sub}
              value={label}
              maxLength={30}
              onChange={(e) => {
                setLabel(e.target.value)
                setError(null)
              }}
              placeholder="Subcategory name"
              className={FIELD}
            />
            <p className={LABEL}>IN</p>
            <Chips items={heads.map((h) => ({ key: h.key, label: `${h.icon ?? ''} ${h.label}` }))} value={head} onChange={setHead} />
            <Chips
              items={[
                { key: 'fixed', label: 'Fixed cost' },
                { key: 'variable', label: 'Variable' },
              ]}
              value={group}
              onChange={setGroup}
            />
            {sub?.system && <p className="text-[11px] text-ink-muted">The budget maths uses this one, so it can be renamed but not deleted.</p>}
            {error && <p className="text-xs font-medium text-cat-rose-ink">{error}</p>}
            <button type="button" disabled={busy} onClick={save} className={PRIMARY}>
              {sub ? 'Save' : 'Add subcategory'}
            </button>
            {sub && <KeywordList category={sub.key} options={options} setOptions={setOptions} />}
          </div>
        )}
      </ItemSheet>
      <ConfirmDialog
        open={confirm}
        title={`Delete “${sub?.label}”?`}
        message="No transaction uses it. You can undo for a few seconds."
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

// ------------------------------------------------------------------------------ keywords

/** The built-in categories (income, savings, card, shared, transfer): only their keywords can change. */
export function SpecialSheet({ category, options, setOptions, onClose }: Omit<Shared, 'onRefsChanged'> & { category: SpecialCategory }) {
  const info = SPECIAL_INFO[category]
  return (
    <ItemSheet title={`${info.icon} ${info.label}`} onClose={onClose}>
      <p className="mb-2 text-[11px] text-ink-muted">Built in — the budget maths treats it specially, so only the keywords that guess it can change.</p>
      <KeywordList category={category} options={options} setOptions={setOptions} />
    </ItemSheet>
  )
}

/**
 * The keyword patterns that guess `category` on import. Each is a regular expression tested
 * against the lower-cased transaction text; across all categories the first match wins, in order.
 * ponytail: ↑/↓ only reorders within this category's list (by swapping global positions); a
 * clash between two categories' patterns is settled by moving one of them.
 */
function KeywordList({ category, options, setOptions }: { category: string; options: OptionRow[]; setOptions: SetOptions }) {
  const { offerUndo } = useEdit()
  const all = liveOptions(options, 'budget_keyword')
  const mine = all.filter((k) => k.meta.category === category)
  const [draft, setDraft] = useState('')
  const { busy, error, setError, run } = useRun()

  const check = (pattern: string) => (safeRegExp(pattern) ? null : pattern.trim() ? 'That pattern isn’t valid — check brackets and backslashes.' : 'Type a word or pattern.')

  const add = () =>
    run(async () => {
      const problem = check(draft)
      if (problem) return setError(problem)
      const created = await insertOption({ kind: 'budget_keyword', key: newKey('kw'), label: draft.trim(), position: Math.max(-1, ...all.map((k) => k.position)) + 1, meta: { category } })
      setOptions((rows) => [...rows, created])
      setDraft('')
    })

  const edit = (k: OptionRow, pattern: string) =>
    run(async () => {
      if (pattern.trim() === k.label) return
      const problem = check(pattern)
      if (problem) return setError(problem)
      await patchOption(k.id, { label: pattern.trim() })
      setOptions((rows) => rows.map((r) => (r.id === k.id ? { ...r, label: pattern.trim() } : r)))
    })

  const swap = (i: number, j: number) =>
    run(async () => {
      const a = mine[i]
      const b = mine[j]
      await Promise.all([patchOption(a.id, { position: b.position }), patchOption(b.id, { position: a.position })])
      setOptions((rows) => rows.map((r) => (r.id === a.id ? { ...r, position: b.position } : r.id === b.id ? { ...r, position: a.position } : r)))
    })

  const remove = (k: OptionRow) =>
    run(async () => {
      const archivedAt = new Date().toISOString()
      await patchOption(k.id, { archived_at: archivedAt })
      setOptions((rows) => rows.map((r) => (r.id === k.id ? { ...r, archived_at: archivedAt } : r)))
      offerUndo('Keyword deleted', async () => {
        await patchOption(k.id, { archived_at: null })
        setOptions((rows) => rows.map((r) => (r.id === k.id ? { ...r, archived_at: null } : r)))
      })
    })

  return (
    <div className="mt-1 flex flex-col gap-1.5 border-t border-line pt-3">
      <p className={LABEL}>GUESSED ON IMPORT WHEN THE TEXT MATCHES</p>
      <p className="text-[11px] text-ink-muted">Lower-case. | means “or”, \b marks a word edge. A merchant you’ve recategorised by hand always wins over these.</p>
      {mine.map((k, i) => (
        <div key={k.id} className="flex items-center gap-1">
          <input defaultValue={k.label} onBlur={(e) => edit(k, e.target.value)} aria-label="Keyword pattern" className={`${FIELD} min-w-0 flex-1 py-2 font-mono text-[12px]`} />
          <button type="button" disabled={i === 0} onClick={() => swap(i, i - 1)} aria-label="Move keyword up" className="px-1.5 text-ink-3 disabled:opacity-30">
            ↑
          </button>
          <button type="button" disabled={i === mine.length - 1} onClick={() => swap(i, i + 1)} aria-label="Move keyword down" className="px-1.5 text-ink-3 disabled:opacity-30">
            ↓
          </button>
          <button type="button" onClick={() => remove(k)} aria-label="Delete keyword" className="px-1.5 text-ink-faint">
            ✕
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            add()
          }}
          placeholder="e.g. willys|lidl"
          aria-label="New keyword"
          className={`${FIELD} min-w-0 flex-1 py-2 font-mono text-[12px]`}
        />
        <button type="button" disabled={busy || !draft.trim()} onClick={add} className="shrink-0 rounded-full bg-pine px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
          Add
        </button>
      </div>
      {error && <p className="text-xs font-medium text-cat-rose-ink">{error}</p>}
    </div>
  )
}
