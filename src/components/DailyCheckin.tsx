import { useEffect, useRef, useState } from 'react'
import { format, subDays } from 'date-fns'
import { supabase } from '../lib/supabase'
import { CATEGORY_STYLES } from '../lib/categories'
import {
  checkinQuestions,
  descriptor,
  diaryPrompts,
  headline,
  MOMENT_COLOR,
  momentKey,
  type CheckinKey,
  type DailyCheckin as Checkin,
  type Moment,
  type Scores,
} from '../lib/dailyCheckin'
import { loadDayMoments } from '../lib/dayMoments'
import { getOptionRows } from '../lib/optionStore'
import type { OptionRow } from '../lib/editable'
import { useEdit } from '../contexts/EditContext'
import { EditDots, Pressable } from './ItemMenu'
import { OptionSheet } from './OptionSheet'
import { SettingChips } from './SettingChips'

// The evening check-in, full screen over Today (design_handoff_daily_checkin_diary):
//   grade    — all six ratings on one screen as drag sliders
//   diary    — "Your day" timeline built from the day's real data (tap a moment to add a
//              line about it) + free diary writing with prompt chips
//   read     — the saved day: score tiles, a one-line headline vs the week, diary, moments
// A day that's already saved opens on `read` (with Edit); a new one on `grade`. Closing
// from grade/diary discards; nothing is written until "Save day".

type Mode = 'loading' | 'grade' | 'diary' | 'read'
const LABEL = 'text-[11px] font-semibold tracking-[0.1em] text-ink-3'
/** Where an untouched slider sits. */
const MIDDLE = 5

// The questions and prompts are edited right here (✎ in the header, or a long-press). Deleting a
// question needs no "move": past days keep its score in `scores`, it just stops being asked.
type Sheet = { kind: 'checkin_question' | 'diary_prompt'; row: OptionRow | null }

export function DailyCheckin({ date, onClose, onSaved }: { date: string; onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState<Mode>('loading')
  const [scores, setScores] = useState<Record<CheckinKey, number>>({})
  // The saved day's scores as loaded — kept so a question deleted since doesn't lose its value on re-save.
  const [savedScores, setSavedScores] = useState<Scores>({})
  const { editing, toggleEditing } = useEdit()
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const questions = checkinQuestions()
  const rowOf = (kind: Sheet['kind'], match: (r: OptionRow) => boolean) => getOptionRows().find((r) => r.kind === kind && !r.archived_at && match(r)) ?? null
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
      const s = saved.scores ?? {}
      setSavedScores(s)
      setScores(Object.fromEntries(Object.entries(s).filter(([, v]) => v != null)) as Record<CheckinKey, number>)
      setTouched(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v != null])))
      setDiary(saved.note ?? '')
    }
    setMode(saved ? 'read' : 'grade')
  }

  useEffect(() => {
    load()
  }, [date])

  const finalScores: Scores = { ...savedScores, ...Object.fromEntries(questions.map((q) => [q.key, touched[q.key] ? (scores[q.key] ?? MIDDLE) : null])) }

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
      supabase
        .from('daily_checkins')
        .upsert({ user_id: user.id, date, scores: Object.fromEntries(Object.entries(finalScores).filter(([, v]) => v != null)), note: diary.trim() || null }, { onConflict: 'user_id,date' }),
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

  const sheetView =
    sheet?.kind === 'checkin_question' ? (
      <OptionSheet
        kind="checkin_question"
        row={sheet.row}
        noun="question"
        noIcon
        newMeta={{ question: '', low: '', high: '' }}
        onClose={() => setSheet(null)}
        fields={(meta, set) => (
          <>
            <input
              value={String(meta.question ?? '')}
              onChange={(e) => set({ question: e.target.value })}
              maxLength={80}
              placeholder="The question, e.g. How well did you sleep?"
              aria-label="Question"
              className="rounded-[14px] border border-line bg-page px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-pine"
            />
            <div className="flex gap-2">
              {(['low', 'high'] as const).map((end) => (
                <input
                  key={end}
                  value={String(meta[end] ?? '')}
                  onChange={(e) => set({ [end]: e.target.value })}
                  maxLength={20}
                  placeholder={end === 'low' ? 'Word at 1, e.g. Awful' : 'Word at 10, e.g. Great'}
                  aria-label={end === 'low' ? 'Word at 1' : 'Word at 10'}
                  className="min-w-0 flex-1 rounded-[14px] border border-line bg-page px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-pine"
                />
              ))}
            </div>
            <p className="text-[11px] text-ink-muted">Ask it so 10 is the good end — that keeps the scores comparable.</p>
          </>
        )}
      />
    ) : sheet?.kind === 'diary_prompt' ? (
      <OptionSheet kind="diary_prompt" row={sheet.row} noun="prompt" noIcon maxLength={60} onClose={() => setSheet(null)} />
    ) : null

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
            <IconButton onClick={toggleEditing} label={editing ? 'Done editing' : 'Edit questions'} glyph="✎" />
            <span className="shrink-0 rounded-full bg-white/16 px-2.5 py-[5px] text-xs font-semibold">1 / 2</span>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-5 pt-[18px] pb-2">
          {questions.map((q) => {
            const k = q.key
            const value = scores[k] ?? MIDDLE
            const edit = () => setSheet({ kind: 'checkin_question', row: rowOf('checkin_question', (r) => r.key === k) })
            return (
              <div key={k} className="rounded-[20px] border border-line bg-surface px-4 pt-3.5 pb-2">
                <div className="flex items-baseline gap-2">
                  <Pressable type="button" onClick={() => editing && edit()} onLongPress={edit} className="text-sm font-semibold text-ink">
                    {q.label}
                  </Pressable>
                  {editing && <EditDots onClick={edit} label={q.label} />}
                  <span className="flex-1 text-xs font-medium text-ink-muted">{descriptor(k, value)}</span>
                  <span className={`text-xl font-semibold tabular-nums ${touched[k] ? 'text-pine' : 'text-ink-faint'}`}>{value}</span>
                </div>
                {editing && q.question && <p className="mt-0.5 text-[11px] text-ink-muted">{q.question}</p>}
                <Slider
                  label={q.label}
                  value={value}
                  onChange={(v) => {
                    setScores((s) => ({ ...s, [k]: v }))
                    setTouched((t) => ({ ...t, [k]: true }))
                  }}
                />
              </div>
            )
          })}
          {editing && (
            <button onClick={() => setSheet({ kind: 'checkin_question', row: null })} className="rounded-[20px] border border-dashed border-line-strong py-3 text-sm font-semibold text-pine">
              + New question
            </button>
          )}
          {/* Checking in after midnight still counts for the day before, until this hour. */}
          <SettingChips keys={['checkin_day_starts_hour']} />
        </div>
        {sheetView}
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
            <button
              onClick={toggleEditing}
              aria-label={editing ? 'Done editing' : 'Edit prompts'}
              className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[14px] text-base ${editing ? 'bg-pine text-white' : 'bg-track text-ink'}`}
            >
              ✎
            </button>
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
              {diaryPrompts().map((p) => {
                const edit = () => setSheet({ kind: 'diary_prompt', row: rowOf('diary_prompt', (r) => r.label === p) })
                return (
                  <span key={p} className="flex shrink-0 items-center gap-1">
                    <Pressable
                      onLongPress={edit}
                      onClick={() => setDiary((d) => (d.trim() ? `${d.trimEnd()}\n\n${p} — ` : `${p} — `))}
                      className="rounded-full bg-cat-emerald-tint px-3 py-1.5 text-xs font-medium text-cat-emerald-ink"
                    >
                      {p}
                    </Pressable>
                    {editing && <EditDots onClick={edit} label={p} />}
                  </span>
                )
              })}
              {editing && (
                <button onClick={() => setSheet({ kind: 'diary_prompt', row: null })} className="shrink-0 rounded-full border border-dashed border-line-strong px-3 py-1.5 text-xs font-medium text-pine">
                  + New prompt
                </button>
              )}
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
        {sheetView}
      </div>
    )
  }

  // ---------------------------------------------------------------- 3. read-back
  const summary = headline(finalScores, previous.map((p) => p.scores ?? {}))
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
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(questions.length, 1)}, minmax(0, 1fr))` }}>
          {questions.map((q) => (
            <div key={q.key} className="flex flex-col items-center rounded-xl bg-white/14 py-1.5">
              <span className="text-base font-semibold tabular-nums">{finalScores[q.key] ?? '–'}</span>
              <span className="w-full truncate px-0.5 text-center text-[9px] font-medium text-white/85">{q.label}</span>
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
