import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { periodStartISO, todayISO } from '../lib/dates'
import { mediaInfo, mediaKinds, type MediaEntry, type MediaKind } from '../lib/media'
import { findOption } from '../lib/optionStore'
import type { OptionRow } from '../lib/editable'
import { useEdit } from '../contexts/EditContext'
import { EditDots, useLongPress } from './ItemMenu'
import { OptionSheet, type RefMover } from './OptionSheet'
import { ChipRail, Screen } from './Screen'
import { ConfirmDialog } from './ConfirmDialog'

// Journal → Media: one quick entry per book/game/movie/series finished — title, 1–5 stars,
// an optional line of review. Kept to the fewest fields on purpose (Pontus drops anything
// that turns into admin). Goals like "Read 12 books" count these rows (mediaMetrics()); the kinds are edited in place (✎ or long-press).
// Renders its own <Screen>; Journal hands over its tab pills, like Finance.

const FIELD = 'min-w-0 rounded-xl border border-line bg-page px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-disabled focus:border-pine'

// A kind's entries move with it when it's deleted.
const KIND_REFS: RefMover = {
  noun: (n) => `${n} ${n === 1 ? 'entry' : 'entries'}`,
  valueOf: (r) => r.key,
  find: async (key) => ((await supabase.from('media_entries').select('id').eq('kind', key).throwOnError()).data ?? []).map((r) => r.id as string),
  move: async (ids, to) => {
    await supabase.from('media_entries').update({ kind: to }).in('id', ids).throwOnError()
  },
}

/** One segment of the kind picker: tap selects, long-press (or its ⋯ in edit mode) edits the kind. */
function KindSegment({ kind, active, onSelect, onEdit }: { kind: MediaKind; active: boolean; onSelect: () => void; onEdit: () => void }) {
  const { editing } = useEdit()
  const press = useLongPress(onEdit)
  const info = mediaInfo(kind)
  return (
    <span className={`flex min-w-[22%] flex-1 items-center justify-center gap-1 rounded-xl ${active ? 'bg-surface shadow-card' : ''}`}>
      <button
        type="button"
        onClick={onSelect}
        {...press}
        className={`select-none py-2 text-xs [-webkit-touch-callout:none] ${active ? 'font-semibold text-pine-dark' : 'font-medium text-ink-3'}`}
      >
        {info.icon} {info.label}
      </button>
      {editing && <EditDots onClick={onEdit} label={info.label} />}
    </span>
  )
}

function Stars({ value, onChange, size = 'text-xl' }: { value: number | null; onChange?: (v: number | null) => void; size?: string }) {
  return (
    <span className="flex gap-0.5" aria-label={value ? `${value} of 5` : 'Not rated'}>
      {[1, 2, 3, 4, 5].map((n) => {
        const star = <span className={`${size} leading-none ${value != null && n <= value ? 'text-[#c9a55a]' : 'text-[#ddd5c6]'}`}>★</span>
        return onChange ? (
          // Tapping the current rating again clears it — rating is optional.
          <button key={n} type="button" onClick={() => onChange(value === n ? null : n)} aria-label={`${n} star${n === 1 ? '' : 's'}`}>
            {star}
          </button>
        ) : (
          <span key={n}>{star}</span>
        )
      })}
    </span>
  )
}

export function Media({ segments }: { segments: React.ReactNode }) {
  const [entries, setEntries] = useState<MediaEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState<MediaKind>(() => mediaKinds()[0]?.key ?? '')
  const { editing } = useEdit()
  const [kindSheet, setKindSheet] = useState<OptionRow | 'new' | null>(null)
  const editKind = (key: MediaKind) => setKindSheet(findOption('media_kind', key) ?? null)
  const [title, setTitle] = useState('')
  const [rating, setRating] = useState<number | null>(null)
  const [review, setReview] = useState('')
  const [date, setDate] = useState(todayISO())
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<'all' | MediaKind>('all')
  const [confirmDelete, setConfirmDelete] = useState<MediaEntry | null>(null)

  async function load() {
    const { data } = await supabase.from('media_entries').select('*').order('finished_on', { ascending: false }).order('created_at', { ascending: false })
    setEntries((data ?? []) as MediaEntry[])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('media_entries').insert({ user_id: user.id, title: title.trim(), kind, rating, review: review.trim() || null, finished_on: date })
    setTitle('')
    setRating(null)
    setReview('')
    setDate(todayISO())
    setSaving(false)
    load()
  }

  async function remove(entry: MediaEntry) {
    setConfirmDelete(null)
    setEntries((es) => es.filter((e) => e.id !== entry.id))
    await supabase.from('media_entries').delete().eq('id', entry.id)
  }

  // Live kinds in order, then any kind an entry still has after its kind was deleted.
  const liveKinds = mediaKinds().map((k) => k.key)
  const allKinds = [...liveKinds, ...new Set(entries.map((e) => e.kind).filter((k) => !liveKinds.includes(k)))]
  const yearStart = periodStartISO('year')
  const thisYear = entries.filter((e) => e.finished_on >= yearStart)
  const shown = filter === 'all' ? entries : entries.filter((e) => e.kind === filter)
  const rated = shown.filter((e) => e.rating != null)
  const avg = rated.length ? rated.reduce((s, e) => s + (e.rating as number), 0) / rated.length : null

  const hero = (
    <>
      {segments}
      <div className="mt-5 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.07em] text-white/72">FINISHED IN {format(new Date(), 'yyyy')}</p>
          <p className="mt-1 text-[34px] font-semibold leading-none">{thisYear.length}</p>
        </div>
        <span className="flex flex-wrap justify-end gap-1.5">
          {allKinds.filter((k) => thisYear.some((e) => e.kind === k)).map((k) => (
            <span key={k} className="rounded-full bg-white/16 px-[11px] py-[5px] text-xs font-medium text-white">
              {mediaInfo(k).icon} {thisYear.filter((e) => e.kind === k).length}
            </span>
          ))}
        </span>
      </div>
    </>
  )

  return (
    <Screen title="Journal" onRefresh={load} hero={hero}>
      <form onSubmit={save} className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-3.5 shadow-card">
        <div className="flex flex-wrap gap-1 rounded-2xl bg-page p-1">
          {liveKinds.map((k) => (
            <KindSegment key={k} kind={k} active={kind === k} onSelect={() => setKind(k)} onEdit={() => editKind(k)} />
          ))}
          {editing && (
            <button type="button" onClick={() => setKindSheet('new')} className="min-w-[22%] flex-1 rounded-xl py-2 text-xs font-medium text-pine">
              + New type
            </button>
          )}
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${mediaInfo(kind).label} title`} className={FIELD} />
        <div className="flex items-center justify-between gap-3">
          <Stars value={rating} onChange={setRating} size="text-[26px]" />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Finished on" className={FIELD} />
        </div>
        <textarea value={review} onChange={(e) => setReview(e.target.value)} rows={2} placeholder="A line or two (optional)" className={FIELD} />
        <button type="submit" disabled={!title.trim() || saving} className="rounded-2xl bg-pine py-3 text-sm font-semibold text-white disabled:opacity-50">
          Log {mediaInfo(kind).label.toLowerCase()}
        </button>
      </form>

      <ChipRail
        options={[{ id: 'all' as const, label: `All ${entries.length}` }, ...allKinds.map((k) => ({ id: k, label: `${mediaInfo(k).icon} ${entries.filter((e) => e.kind === k).length}` }))]}
        value={filter}
        onChange={setFilter}
      />
      {avg != null && <p className="-mt-1 px-1 text-[11px] font-medium text-ink-muted">Average rating {avg.toFixed(1)} of 5</p>}

      {loading ? (
        <p className="text-sm text-ink-disabled">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-ink-disabled">Nothing logged yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((e) => (
            <div key={e.id} className="flex gap-3 rounded-[18px] border border-line bg-surface px-3.5 py-3">
              <span className="text-xl leading-none">{mediaInfo(e.kind).icon}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-sm font-semibold text-ink">{e.title}</span>
                  <button onClick={() => setConfirmDelete(e)} className="shrink-0 text-ink-faint" aria-label="Delete">
                    ✕
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {e.rating != null && <Stars value={e.rating} size="text-sm" />}
                  <span className="text-[11px] text-ink-muted">{format(new Date(e.finished_on + 'T00:00:00'), 'd MMM yyyy')}</span>
                </div>
                {e.review && <p className="text-xs leading-relaxed text-ink-2">{e.review}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete != null}
        title={`Delete "${confirmDelete?.title ?? ''}"?`}
        message="Removes it and its review."
        confirmLabel="Delete"
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
      {kindSheet && (
        <OptionSheet
          kind="media_kind"
          row={kindSheet === 'new' ? null : kindSheet}
          noun="type"
          newMeta={{ plural: '' }}
          refs={KIND_REFS}
          onChanged={load}
          onClose={() => setKindSheet(null)}
          fields={(meta, set) => (
            <input
              value={String(meta.plural ?? '')}
              onChange={(e) => set({ plural: e.target.value })}
              maxLength={30}
              placeholder="Plural, e.g. Podcasts"
              aria-label="Plural"
              className="rounded-[14px] border border-line bg-page px-3 py-2.5 text-sm font-medium text-ink outline-none placeholder:text-ink-faint focus:border-pine"
            />
          )}
        />
      )}
    </Screen>
  )
}
