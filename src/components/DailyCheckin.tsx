import { useEffect, useRef, useState } from 'react'
import { format, subDays } from 'date-fns'
import { supabase } from '../lib/supabase'
import { CATEGORY_STYLES } from '../lib/categories'
import {
  CHECKIN_INFO,
  CHECKIN_KEYS,
  descriptor,
  headline,
  MOMENT_COLOR,
  momentKey,
  type CheckinKey,
  type DailyCheckin as Checkin,
  type Moment,
} from '../lib/dailyCheckin'
import { loadDayMoments } from '../lib/dayMoments'

// The evening check-in, full screen over Today (design_handoff_daily_checkin_diary):
//   grade    — all six ratings on one screen as drag sliders
//   diary    — "Your day" timeline built from the day's real data (tap a moment to add a
//              line about it) + free diary writing with prompt chips
//   read     — the saved day: score tiles, a one-line headline vs the week, diary, moments
// A day that's already saved opens on `read` (with Edit); a new one on `grade`. Closing
// from grade/diary discards; nothing is written until "Save day".

type Mode = 'loading' | 'grade' | 'diary' | 'read'
type Scores = Record<CheckinKey, number>
const START: Scores = { mood: 5, energy: 5, calm: 5, focus: 5, connection: 5, body: 5 }
const PROMPTS = ['Best part of today', 'What drained me', 'Tomorrow I want to']
const LABEL = 'text-[11px] font-semibold tracking-[0.1em] text-ink-3'

export function DailyCheckin({ date, onClose, onSaved }: { date: string; onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState<Mode>('loading')
  const [scores, setScores] = useState<Scores>(START)
  // Untouched sliders save as null — a 5 that was never considered shouldn't drag averages.
  const [touched, setTouched] = useState<Partial<Record<CheckinKey, boolean>>>({})
  const [diary, setDiary] = useState('')
  const [moments, setMoments] = useState<Moment[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [savedNoteKeys, setSavedNoteKeys] = useState<string[]>([])
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [justOpened, setJustOpened] = useState<string | null>(null)
  const [previous, setPrevious] = useState<Checkin[]>([])
  const [saving, setSaving] = useState(false)

  async function load() {
    const weekAgo = format(subDays(new Date(date + 'T00:00:00'), 7), 'yyyy-MM-dd')
    const [{ data: row }, { data: noteRows }, dayMoments, { data: prev }] = await Promise.all([
      supabase.from('daily_checkins').select('*').eq('date', date).maybeSingle(),
      supabase.from('daily_checkin_moments').select('source, source_id, note').eq('date', date),
      loadDayMoments(date),
      supabase.from('daily_checkins').select('*').gte('date', weekAgo).lt('date', date),
    ])
    const loadedNotes = Object.fromEntries((noteRows ?? []).map((n) => [momentKey({ source: n.source, sourceId: n.source_id }), n.note as string]))
    setMoments(dayMoments)
    setNotes(loadedNotes)
    setSavedNoteKeys(Object.keys(loadedNotes))
    setOpen(Object.fromEntries(Object.keys(loadedNotes).map((k) => [k, true])))
    setPrevious((prev ?? []) as Checkin[])
    const saved = row as Checkin | null
    if (saved) {
      setScores(Object.fromEntries(CHECKIN_KEYS.map((k) => [k, saved[k] ?? 5])) as Scores)
      setTouched(Object.fromEntries(CHECKIN_KEYS.map((k) => [k, saved[k] != null])))
      setDiary(saved.note ?? '')
    }
    setMode(saved ? 'read' : 'grade')
  }

  useEffect(() => {
    load()
  }, [date])

  const finalScores = Object.fromEntries(CHECKIN_KEYS.map((k) => [k, touched[k] ? scores[k] : null])) as Record<CheckinKey, number | null>

  async function save() {
    if (saving) return
    setSaving(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const filled = moments.filter((m) => notes[momentKey(m)]?.trim())
    const cleared = savedNoteKeys.filter((k) => !notes[k]?.trim())
    await Promise.all([
      supabase.from('daily_checkins').upsert({ user_id: user.id, date, ...finalScores, note: diary.trim() || null }, { onConflict: 'user_id,date' }),
      filled.length &&
        supabase.from('daily_checkin_moments').upsert(
          filled.map((m) => ({ user_id: user.id, date, source: m.source, source_id: m.sourceId, note: notes[momentKey(m)].trim() })),
          { onConflict: 'user_id,date,source,source_id' },
        ),
      ...cleared.map((k) => {
        const [source, sourceId] = k.split(/:(.*)/)
        return supabase.from('daily_checkin_moments').delete().eq('date', date).eq('source', source).eq('source_id', sourceId)
      }),
    ])
    setSavedNoteKeys(filled.map(momentKey))
    setSaving(false)
    onSaved()
    setMode('read')
  }

  if (mode === 'loading') return <div className="fixed inset-0 z-50 bg-page" />
  const dateLabel = format(new Date(date + 'T00:00:00'), 'EEEE d MMMM')

  // ---------------------------------------------------------------- 1. grade
  if (mode === 'grade') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-page">
        <header className="hero shrink-0">
          <div className="flex items-center gap-3">
            <IconButton onClick={onClose} label="Close" glyph="✕" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[22px] font-semibold">How was today?</h1>
              <p className="mt-0.5 text-xs font-medium text-white">{dateLabel} · drag to rate</p>
            </div>
            <span className="shrink-0 rounded-full bg-white/16 px-2.5 py-[5px] text-xs font-semibold">1 / 2</span>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-5 pt-[18px] pb-2">
          {CHECKIN_KEYS.map((k) => (
            <div key={k} className="rounded-[20px] border border-line bg-surface px-4 pt-3.5 pb-2">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-ink">{CHECKIN_INFO[k].label}</span>
                <span className="flex-1 text-xs font-medium text-ink-muted">{descriptor(k, scores[k])}</span>
                <span className={`text-xl font-semibold tabular-nums ${touched[k] ? 'text-pine' : 'text-ink-faint'}`}>{scores[k]}</span>
              </div>
              <Slider
                label={CHECKIN_INFO[k].label}
                value={scores[k]}
                onChange={(v) => {
                  setScores((s) => ({ ...s, [k]: v }))
                  setTouched((t) => ({ ...t, [k]: true }))
                }}
              />
            </div>
          ))}
        </div>
        <div className="shrink-0 px-5 pt-3 pb-10 safe-bottom">
          <button onClick={() => setMode('diary')} className="w-full rounded-[20px] bg-pine py-4 text-sm font-semibold text-white">
            Continue to journal
          </button>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------- 2. diary
  if (mode === 'diary') {
    const words = diary.trim().split(/\s+/).filter(Boolean).length
    const noted = moments.filter((m) => notes[momentKey(m)]?.trim()).length
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-surface">
        <header className="shrink-0 border-b border-track bg-surface px-5 pb-3.5" style={{ paddingTop: 'max(56px, calc(env(safe-area-inset-top) + 10px))' }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setMode('grade')} aria-label="Back" className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[14px] bg-track text-base text-ink">
              ←
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-[15px] font-semibold text-ink">Diary</h1>
              <p className="text-xs font-medium text-ink-muted">{dateLabel}</p>
            </div>
            <span className="shrink-0 rounded-full bg-track px-2.5 py-[5px] text-xs font-semibold text-ink-3">2 / 2</span>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto px-5 pt-5 pb-6">
          {moments.length > 0 && (
            <section>
              <div className="mb-2 flex items-baseline justify-between">
                <p className={LABEL}>YOUR DAY</p>
                <span className="text-xs font-medium text-ink-muted">Tap a moment to add a line</span>
              </div>
              {moments.map((m, i) => {
                const key = momentKey(m)
                const style = CATEGORY_STYLES[MOMENT_COLOR[m.source]]
                const isOpen = open[key]
                return (
                  <div key={key} className="flex">
                    <span className="w-10 shrink-0 pt-3 text-right text-xs font-medium tabular-nums text-ink-muted">{m.time ?? 'Today'}</span>
                    <Rail first={i === 0} last={i === moments.length - 1} dot={style.dot} />
                    <div className="min-w-0 flex-1 pb-1">
                      <button
                        onClick={() => {
                          // A row with a note stays open.
                          setOpen((o) => ({ ...o, [key]: !o[key] || !!notes[key]?.trim() }))
                          setJustOpened(key)
                        }}
                        className={`flex w-full items-center gap-2.5 rounded-2xl px-3 py-2 text-left ${isOpen ? style.bg : ''}`}
                      >
                        <span className="shrink-0 text-base">{m.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{m.title}</span>
                          <span className={`block truncate text-xs font-medium ${style.text}`}>{m.meta}</span>
                        </span>
                        {!isOpen && <span className="shrink-0 text-lg text-ink-muted">+</span>}
                      </button>
                      {isOpen && (
                        <input
                          autoFocus={justOpened === key}
                          value={notes[key] ?? ''}
                          onChange={(e) => setNotes((n) => ({ ...n, [key]: e.target.value }))}
                          placeholder="Add a line about this…"
                          className="mt-1 mb-2 ml-4 block w-[calc(100%-16px)] border-l-2 border-line bg-transparent py-1 pl-3 text-sm italic text-ink-2 outline-none placeholder:text-ink-disabled"
                        />
                      )}
                    </div>
                  </div>
                )
              })}
            </section>
          )}

          <section className="flex flex-col gap-2.5">
            <p className={LABEL}>DEAR DIARY</p>
            <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
              {PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => setDiary((d) => (d.trim() ? `${d.trimEnd()}\n\n${p} — ` : `${p} — `))}
                  className="shrink-0 rounded-full bg-cat-emerald-tint px-3 py-1.5 text-xs font-medium text-cat-emerald-ink"
                >
                  {p}
                </button>
              ))}
            </div>
            <textarea
              value={diary}
              onChange={(e) => setDiary(e.target.value)}
              rows={9}
              placeholder="How did the day go? Write as much as you like…"
              className="rounded-[20px] border border-line bg-surface p-4 text-[15px] leading-[1.7] text-ink outline-none placeholder:text-ink-disabled focus:border-pine"
            />
          </section>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-track px-5 pt-3 pb-10 safe-bottom">
          <span className="text-xs font-medium text-ink-muted">
            {words} word{words === 1 ? '' : 's'} · {noted} moment{noted === 1 ? '' : 's'} noted
          </span>
          <button onClick={save} disabled={saving} className="rounded-[20px] bg-pine px-[22px] py-[15px] text-sm font-semibold text-white disabled:opacity-50">
            Save day
          </button>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------- 3. read-back
  const summary = headline(finalScores, previous)
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-page">
      <header className="hero flex shrink-0 flex-col gap-3.5">
        <div className="flex items-center gap-3">
          <IconButton onClick={onClose} label="Back" glyph="←" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[22px] font-semibold">{dateLabel}</h1>
            {summary && <p className="mt-0.5 text-xs font-medium text-white">{summary}</p>}
          </div>
          <button onClick={() => setMode('grade')} className="shrink-0 rounded-full bg-white/16 px-2.5 py-[5px] text-xs font-semibold">
            Edit
          </button>
        </div>
        <div className="grid grid-cols-6 gap-1.5">
          {CHECKIN_KEYS.map((k) => (
            <div key={k} className="flex flex-col items-center rounded-xl bg-white/14 py-1.5">
              <span className="text-base font-semibold tabular-nums">{finalScores[k] ?? '–'}</span>
              <span className="text-[9px] font-medium text-white/85">{CHECKIN_INFO[k].label}</span>
            </div>
          ))}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pt-5 pb-8">
        {diary.trim() && (
          <div className="rounded-3xl border border-line bg-surface p-[18px]">
            <p className={LABEL}>DIARY</p>
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-[1.7] text-ink">{diary.trim()}</p>
          </div>
        )}
        {moments.length > 0 && (
          <div className="rounded-3xl border border-line bg-surface px-[18px] py-3.5">
            <p className={LABEL}>THE DAY</p>
            {moments.map((m) => {
              const note = notes[momentKey(m)]?.trim()
              return (
                <div key={momentKey(m)} className="flex gap-2 border-b border-track py-2.5 last:border-b-0">
                  <span className="w-[38px] shrink-0 text-xs text-ink-muted tabular-nums">{m.time ?? 'Today'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">
                      {m.icon} {m.title}
                      <span className={`text-xs font-normal ${CATEGORY_STYLES[MOMENT_COLOR[m.source]].text}`}> · {m.meta}</span>
                    </p>
                    {note && <p className="mt-1 text-[13px] italic text-ink-2">“{note}”</p>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {!diary.trim() && moments.length === 0 && <p className="text-sm text-ink-disabled">Nothing written for this day — tap Edit to add to it.</p>}
      </div>
    </div>
  )
}

function IconButton({ onClick, label, glyph }: { onClick: () => void; label: string; glyph: string }) {
  return (
    <button onClick={onClick} aria-label={label} className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[14px] bg-white/16 text-base text-white">
      {glyph}
    </button>
  )
}

/** The timeline's vertical line + dot; the line stops at the first and last dot. */
function Rail({ first, last, dot }: { first: boolean; last: boolean; dot: string }) {
  return (
    <span className="relative mx-1.5 w-3.5 shrink-0">
      {!(first && last) && (
        <span
          className="absolute left-1/2 w-0.5 -translate-x-1/2 bg-line"
          style={{ top: first ? 19 : 0, bottom: last ? undefined : 0, height: last ? 19 : undefined }}
        />
      )}
      <span className={`absolute top-3.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full ${dot}`} />
    </span>
  )
}

/** 1–10 drag slider: pointer capture so tap and drag both work, arrow keys for ±1. */
function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const pct = ((value - 1) / 9) * 100
  function fromPointer(e: React.PointerEvent) {
    const r = ref.current!.getBoundingClientRect()
    onChange(Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 9) + 1)
  }
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={1}
      aria-valuemax={10}
      aria-valuenow={value}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        fromPointer(e)
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && fromPointer(e)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(Math.min(10, value + 1))
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(Math.max(1, value - 1))
        else return
        e.preventDefault()
      }}
      className="relative h-10 cursor-pointer touch-none outline-none"
    >
      <span className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-track" />
      <span className="absolute top-1/2 left-0 h-2 -translate-y-1/2 rounded-full bg-gradient-to-r from-pine-arc to-pine" style={{ width: `${pct}%` }} />
      <span
        className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-pine bg-surface"
        style={{ left: `${pct}%`, boxShadow: '0 3px 10px rgba(63,58,48,.18)' }}
      />
    </div>
  )
}
