import { useEffect, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/dates'
import { BALANCE_REGIONS, SET_TARGET, bestE1rm, formatSets, lastTime, regionBalance } from '../lib/training'
import { ConfirmDialog } from './ConfirmDialog'
import { SwapSheet } from './GymPrograms'
import type { Exercise, GymProgram, GymProgramExercise, GymSession, GymSessionSet } from '../lib/types'

// Live workout mode: one exercise at a time, every set pre-filled from last time so a
// normal set is one tap. It writes the same gym_sessions / gym_session_sets rows the old
// log sheet did — the session on the first tick, each set as it's ticked — and mirrors its
// own state to localStorage, so killing the PWA mid-workout loses nothing and reopening
// the Training tab resumes it.

export const LIVE_KEY = 'liveSession'
const REST_MS = 90_000

/** reps/weight are kept as strings so a half-typed "97." survives the input. */
export interface LiveSet {
  reps: string
  weight: string
  done: boolean
  /** True once the row as currently shown is in gym_session_sets. */
  saved: boolean
  id: string | null
}
export interface LiveExercise {
  name: string
  targetReps: number
  sets: LiveSet[]
}
export interface LiveState {
  date: string
  programId: string | null
  programName: string
  startedAt: number
  sessionId: string | null
  exercises: LiveExercise[]
  index: number
  restEndsAt: number | null
  restAfter: number | null
}

/** An unfinished workout from today, if the app was closed mid-session. */
export function savedLiveState(): LiveState | null {
  try {
    const s = JSON.parse(localStorage.getItem(LIVE_KEY) ?? 'null') as LiveState | null
    return s && s.date === todayISO() ? s : null
  } catch {
    return null
  }
}

function clearSaved() {
  try {
    localStorage.removeItem(LIVE_KEY)
  } catch {
    // Private mode etc. — the sets are in the database either way.
  }
}

/** Set by set from last time; with no history, the program's target reps and no kg. */
function prefill(name: string, count: number, targetReps: number, sessions: GymSession[], setsBySession: Map<string, GymSessionSet[]>): LiveSet[] {
  const last = lastTime(name, sessions, setsBySession)?.sets ?? []
  return Array.from({ length: Math.max(count, 1) }, (_, i) => {
    const p = last[i] ?? last[last.length - 1]
    return { reps: String(p?.reps ?? targetReps), weight: p?.weight != null ? String(Number(p.weight)) : '', done: false, saved: false, id: null }
  })
}

export function newLiveState(
  program: GymProgram,
  programExercises: GymProgramExercise[],
  sessions: GymSession[],
  setsBySession: Map<string, GymSessionSet[]>,
): LiveState {
  return {
    date: todayISO(),
    programId: program.id,
    programName: program.name,
    startedAt: Date.now(),
    sessionId: null,
    exercises: programExercises.map((ex) => ({
      name: ex.name,
      targetReps: ex.target_reps,
      sets: prefill(ex.name, ex.target_sets, ex.target_reps, sessions, setsBySession),
    })),
    index: 0,
    restEndsAt: null,
    restAfter: null,
  }
}

const num = (s: string) => (s.trim() === '' ? null : Number(s))
const fmtKg = (n: number) => String(Math.round(n * 10) / 10)
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "4 × 5 @ 97.5 kg" when every set matches, else each set: "9×60, 4×70, 5×65 kg". */
function summarize(sets: { reps: number | null; weight: number | null }[]): string {
  const [first] = sets
  if (sets.every((s) => s.reps === first?.reps && s.weight === first?.weight)) {
    return `${sets.length} × ${first?.reps ?? '—'}${first?.weight ? ` @ ${fmtKg(first.weight)} kg` : ''}`
  }
  return `${sets.map((s) => `${s.reps ?? '—'}×${s.weight != null ? fmtKg(s.weight) : '—'}`).join(', ')} kg`
}

function Stepper({ label, value, onChange, step, width }: { label: string; value: string; onChange: (v: string) => void; step: number; width: string }) {
  const bump = (d: number) => onChange(fmtKg(Math.max(0, (Number(value) || 0) + d)))
  const btn = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-line bg-surface text-xl text-ink-2'
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-2xl bg-page px-1.5 py-2.5">
      <span className="text-[10px] font-medium text-ink-muted">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => bump(-step)} className={btn} aria-label={`Less ${label}`}>
          −
        </button>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(',', '.'))}
          inputMode="decimal"
          placeholder="—"
          aria-label={label}
          className={`${width} bg-transparent text-center text-[28px] font-semibold text-ink outline-none placeholder:text-ink-faint`}
        />
        <button type="button" onClick={() => bump(step)} className={btn} aria-label={`More ${label}`}>
          +
        </button>
      </div>
    </div>
  )
}

export function LiveSession({
  initial,
  catalog,
  sessions,
  setsBySession,
  allSets,
  sessionsThisWeek,
  onClose,
}: {
  initial: LiveState
  catalog: Exercise[]
  /** Newest first — loaded before this workout started. */
  sessions: GymSession[]
  setsBySession: Map<string, GymSessionSet[]>
  allSets: GymSessionSet[]
  /** Sessions already logged this week, not counting this one. */
  sessionsThisWeek: number
  onClose: () => void
}) {
  const [state, setState] = useState(initial)
  const [selected, setSelected] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [swapIndex, setSwapIndex] = useState<number | null>(null)
  const [finishedAt, setFinishedAt] = useState<number | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const sessionRef = useRef<Promise<string | null> | null>(initial.sessionId ? Promise.resolve(initial.sessionId) : null)
  const inFlight = useRef(new Set<string>())
  const touchX = useRef<number | null>(null)
  const catalogByName = new Map(catalog.map((ex) => [ex.name.toLowerCase(), ex]))

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (finishedAt) return
    try {
      localStorage.setItem(LIVE_KEY, JSON.stringify(state))
    } catch {
      // No storage: resume won't work, but every ticked set is already in the database.
    }
  }, [state, finishedAt])

  // A resumed workout may have ticks that never reached the server (closed while offline).
  useEffect(() => {
    flush()
  }, [])

  function patchSet(exIdx: number, setIdx: number, patch: Partial<LiveSet>) {
    setState((s) => ({
      ...s,
      exercises: s.exercises.map((ex, i) =>
        i !== exIdx ? ex : { ...ex, sets: ex.sets.map((set, j) => (j !== setIdx ? set : { ...set, ...patch })) },
      ),
    }))
  }

  function ensureSession(): Promise<string | null> {
    sessionRef.current ??= (async () => {
      const s = stateRef.current
      const { data } = await supabase
        .from('gym_sessions')
        .insert({ program_id: s.programId, program_name: s.programName, date: s.date })
        .select('id')
        .single()
      if (!data) {
        sessionRef.current = null
        return null
      }
      setState((prev) => ({ ...prev, sessionId: data.id }))
      return data.id as string
    })()
    return sessionRef.current
  }

  // Writes every ticked set that isn't in the database yet (or changed since). Retried on
  // each tick and at the end, so a dropped connection at the gym costs nothing.
  async function flush() {
    const pending = stateRef.current.exercises.flatMap((ex, exIdx) =>
      ex.sets.map((set, setIdx) => ({ ex, set, exIdx, setIdx })).filter(({ set }) => set.done && !set.saved),
    )
    if (!pending.length) return
    const sessionId = await ensureSession()
    if (!sessionId) return
    await Promise.all(
      pending.map(async ({ ex, set, exIdx, setIdx }) => {
        const key = `${exIdx}:${setIdx}`
        if (inFlight.current.has(key)) return
        inFlight.current.add(key)
        const row = { session_id: sessionId, exercise_name: ex.name, set_number: setIdx + 1, reps: num(set.reps), weight: num(set.weight) }
        const { data, error } = set.id
          ? await supabase.from('gym_session_sets').update(row).eq('id', set.id).select('id').single()
          : await supabase.from('gym_session_sets').insert(row).select('id').single()
        inFlight.current.delete(key)
        // Only mark saved if the row still says what was sent — it may have been edited meanwhile.
        const current = stateRef.current.exercises[exIdx]?.sets[setIdx]
        if (!error && data) {
          patchSet(exIdx, setIdx, {
            id: data.id,
            saved: current?.reps === set.reps && current?.weight === set.weight && current?.done === true,
          })
        }
      }),
    )
  }

  function tick(exIdx: number, setIdx: number) {
    const restAt = Date.now() + REST_MS
    setState((s) => ({
      ...s,
      restEndsAt: restAt,
      restAfter: setIdx + 1,
      exercises: s.exercises.map((ex, i) =>
        i !== exIdx ? ex : { ...ex, sets: ex.sets.map((set, j) => (j !== setIdx ? set : { ...set, done: true, saved: false })) },
      ),
    }))
    setSelected(null)
    // setState is async; flush reads the ref, so let this render land first.
    setTimeout(flush, 0)
  }

  function editSet(exIdx: number, setIdx: number, patch: Partial<LiveSet>) {
    patchSet(exIdx, setIdx, { ...patch, saved: false })
  }

  function goTo(index: number) {
    if (index < 0 || index >= state.exercises.length) return
    setSelected(null)
    setState((s) => ({ ...s, index }))
  }

  const anyDone = state.exercises.some((ex) => ex.sets.some((s) => s.done))

  async function end() {
    setConfirmEnd(false)
    await flush()
    clearSaved()
    onClose()
  }

  async function finish() {
    if (!anyDone) {
      clearSaved()
      onClose()
      return
    }
    await flush()
    clearSaved()
    setFinishedAt(Date.now())
  }

  // ---------------------------------------------------------------- finish screen (1e)
  if (finishedAt) {
    const doneByExercise = state.exercises
      .map((ex) => ({ name: ex.name, sets: ex.sets.filter((s) => s.done).map((s) => ({ reps: num(s.reps), weight: num(s.weight) })) }))
      .filter((ex) => ex.sets.length)
    const allDone = doneByExercise.flatMap((ex) => ex.sets)
    const volume = allDone.reduce((sum, s) => sum + (s.reps ?? 0) * (s.weight ?? 0), 0) / 1000
    const priorSets = allSets.filter((s) => s.session_id !== state.sessionId)
    const today = state.date
    const exerciseByName = new Map(catalog.map((ex) => [ex.name.toLowerCase(), ex]))
    const liveSession = { id: 'live', date: today } as GymSession
    const liveSets = doneByExercise.flatMap((ex) => ex.sets.map((s) => ({ ...s, session_id: 'live', exercise_name: ex.name }) as GymSessionSet))
    const priorSessions = sessions.filter((s) => s.id !== state.sessionId)
    const before = regionBalance(priorSessions, priorSets, exerciseByName, today)
    const after = regionBalance([...priorSessions, liveSession], [...priorSets, ...liveSets], exerciseByName, today)
    const touched = new Set(
      doneByExercise.flatMap((ex) => {
        const c = exerciseByName.get(ex.name.toLowerCase())
        return [c?.primary_muscle, c?.secondary_muscle].flatMap((m) =>
          Object.entries(BALANCE_REGIONS)
            .filter(([, muscles]) => m && (muscles as string[]).includes(m))
            .map(([r]) => r),
        )
      }),
    )
    const stat = (value: string, label: string) => (
      <div className="flex flex-col rounded-2xl bg-white/14 px-3 py-2.5">
        <span className="text-xl font-semibold">{value}</span>
        <span className="text-[10px] text-white/78">{label}</span>
      </div>
    )

    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-page">
        <header className="hero shrink-0">
          <p className="text-[11px] font-semibold tracking-[0.07em] text-white/72">
            {format(parseISO(today), 'EEE d MMM').toUpperCase()} · SESSION {sessionsThisWeek + 1} THIS WEEK
          </p>
          <h1 className="mt-2 text-[28px] font-semibold">{state.programName} done</h1>
          <div className="mt-3.5 grid grid-cols-3 gap-2">
            {stat(String(Math.round((finishedAt - state.startedAt) / 60000)), 'minutes')}
            {stat(String(allDone.length), 'sets')}
            {stat(`${volume.toFixed(1)} t`, 'volume')}
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pt-[18px] pb-8 safe-bottom">
          <SectionLabel>WHAT MOVED</SectionLabel>
          <div className="-mt-1 flex flex-col rounded-[20px] border border-line bg-surface">
            {doneByExercise.map((ex, i) => {
              const best = bestE1rm(ex.sets)
              const prev = bestE1rm(priorSets.filter((s) => s.exercise_name.toLowerCase() === ex.name.toLowerCase()))
              const diff = best != null && prev != null ? best - prev : null
              return (
                <div key={ex.name} className={`flex items-center gap-3 px-3.5 py-3 ${i > 0 ? 'border-t border-[#efe9dd]' : ''}`}>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-semibold text-ink">{ex.name}</span>
                    <span className="text-[11px] text-ink-muted">{summarize(ex.sets)}</span>
                  </span>
                  {diff != null && diff > 0.05 && (
                    <span className="shrink-0 rounded-full bg-[#e3efe9] px-2.5 py-1 text-[11px] font-semibold text-[#1f6b5c]">
                      e1RM +{diff.toFixed(1)} kg
                    </span>
                  )}
                  {diff != null && Math.abs(diff) <= 0.05 && <span className="shrink-0 text-[11px] font-medium text-ink-muted">= last time</span>}
                </div>
              )
            })}
          </div>

          {touched.size > 0 && (
            <div className="flex flex-col gap-2 rounded-[20px] border border-line bg-surface p-3.5">
              <span className="text-[13px] font-semibold text-ink">Muscle balance after today</span>
              {after
                .filter((r) => touched.has(r.region))
                .map((r) => {
                  const was = before.find((b) => b.region === r.region)?.perWeek ?? 0
                  return (
                    <div key={r.region} className="flex items-center gap-2.5">
                      <span className="w-[68px] shrink-0 text-xs text-ink">{r.region}</span>
                      <BandBar value={r.perWeek} status={r.status} />
                      <span className={`shrink-0 text-[11px] font-semibold ${r.status === 'in' ? 'text-pine' : 'text-[#8a6321]'}`}>
                        {formatSets(was)} → {formatSets(r.perWeek)}
                      </span>
                    </div>
                  )
                })}
            </div>
          )}

          <div className="flex items-center gap-3 rounded-[18px] bg-[#f3ead6] px-3.5 py-3">
            <span className="text-base">🔗</span>
            <span className="flex-1 text-xs leading-relaxed text-[#5c4216]">
              This session links itself to today's Strava weight training when it syncs. You'd only be asked if there were two to choose
              from.
            </span>
          </div>

          <button onClick={onClose} className="rounded-[18px] bg-pine py-3.5 text-sm font-semibold text-white">
            Back to Training
          </button>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------- exercise view (1d)
  const ex = state.exercises[state.index]
  const firstOpen = ex ? ex.sets.findIndex((s) => !s.done) : -1
  const current = selected ?? (firstOpen >= 0 ? firstOpen : null)
  const last = ex ? lastTime(ex.name, sessions, setsBySession, state.sessionId) : null
  const next = state.exercises[state.index + 1]
  const restLeft = state.restEndsAt != null ? state.restEndsAt - now : null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-page safe-top safe-bottom"
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current == null) return
        const dx = e.changedTouches[0].clientX - touchX.current
        touchX.current = null
        if (Math.abs(dx) > 70) goTo(state.index + (dx < 0 ? 1 : -1))
      }}
    >
      <div className="flex shrink-0 flex-col gap-3.5 px-5 pt-4">
        <div className="flex items-center justify-between">
          <button onClick={() => (anyDone ? setConfirmEnd(true) : end())} className="text-[13px] font-medium text-ink-3">
            ✕ End
          </button>
          <span className="flex flex-col items-center">
            <span className="text-sm font-semibold text-ink">{state.programName}</span>
            <span className="text-[11px] text-ink-muted tabular-nums">{clock(now - state.startedAt)}</span>
          </span>
          <button onClick={finish} className="text-[13px] font-semibold text-pine">
            Finish
          </button>
        </div>
        <div className="flex gap-1">
          {state.exercises.map((e, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={e.name}
              className="h-1 flex-1 rounded-full"
              style={{ background: i === state.index ? '#c9a55a' : e.sets.every((s) => s.done) ? '#8a6321' : '#e2dccf' }}
            />
          ))}
        </div>
      </div>

      {!ex ? (
        <p className="p-5 text-sm text-ink-disabled">This program has no exercises yet.</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pt-[18px] pb-6">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-semibold tracking-[0.07em] text-[#8a6321]">
              EXERCISE {state.index + 1} OF {state.exercises.length}
            </span>
            <div className="flex items-end justify-between gap-3">
              <h2 className="text-[26px] font-semibold leading-tight text-ink">{ex.name}</h2>
              {ex.sets.every((s) => !s.done) && (
                <button onClick={() => setSwapIndex(state.index)} className="shrink-0 pb-1 text-xs font-medium text-ink-3">
                  Swap
                </button>
              )}
            </div>
            <span className="text-xs text-ink-3">
              {last
                ? `Last time, ${format(parseISO(last.date), 'EEE d MMM')}: ${summarize(last.sets.map((s) => ({ reps: s.reps, weight: s.weight != null ? Number(s.weight) : null })))}`
                : 'First time — no numbers to beat yet'}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {ex.sets.map((set, i) => {
              const prev = last?.sets[i]
              const prevW = prev?.weight != null ? Number(prev.weight) : null
              const w = num(set.weight)
              if (i === current) {
                return (
                  <div key={i} className="flex flex-col gap-3 rounded-[22px] border-2 border-[#8a6321] bg-surface p-3.5 shadow-[0_8px_22px_rgba(138,99,33,.16)]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#8a6321]">SET {i + 1}</span>
                      {prev && (
                        <span className="text-[11px] text-ink-muted">
                          last: {prev.reps ?? '—'} × {prevW != null ? fmtKg(prevW) : '—'}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <Stepper label="REPS" value={set.reps} step={1} width="w-9" onChange={(v) => editSet(state.index, i, { reps: v })} />
                      <Stepper label="KG" value={set.weight} step={2.5} width="w-14" onChange={(v) => editSet(state.index, i, { weight: v })} />
                    </div>
                    <button onClick={() => tick(state.index, i)} className="rounded-2xl bg-[#8a6321] py-3.5 text-[15px] font-semibold text-white">
                      ✓ Log set
                    </button>
                  </div>
                )
              }
              return (
                <button
                  key={i}
                  onClick={() => setSelected(i)}
                  className={`flex items-center gap-3 rounded-[18px] py-2.5 pr-3 pl-3.5 text-left ${
                    set.done ? 'border border-line bg-surface' : 'border-[1.5px] border-dashed border-[#d8d1c3]'
                  }`}
                >
                  <span className={`w-[18px] text-xs font-semibold ${set.done ? 'text-ink-muted' : 'text-[#b3ac9d]'}`}>{i + 1}</span>
                  <span className={`flex-1 text-[15px] ${set.done ? 'font-semibold text-ink' : 'font-medium text-ink-muted'}`}>
                    {set.reps || '—'} × {set.weight ? `${set.weight} kg` : '— kg'}
                  </span>
                  {set.done && w != null && prevW != null && w > prevW && (
                    <span className="text-[10px] font-semibold text-[#1f6b5c]">+{fmtKg(w - prevW)}</span>
                  )}
                  <span
                    className={`flex h-[34px] w-[34px] items-center justify-center rounded-full text-[15px] ${
                      set.done ? 'bg-[#8a6321] font-semibold text-white' : 'border-[1.5px] border-[#d8d1c3] text-[#b3ac9d]'
                    }`}
                  >
                    ✓
                  </span>
                </button>
              )
            })}
            <button
              onClick={() =>
                setState((s) => ({
                  ...s,
                  exercises: s.exercises.map((e, i) => {
                    if (i !== s.index) return e
                    const lastSet = e.sets[e.sets.length - 1]
                    return { ...e, sets: [...e.sets, { reps: lastSet?.reps ?? String(e.targetReps), weight: lastSet?.weight ?? '', done: false, saved: false, id: null }] }
                  }),
                }))
              }
              className="self-start text-xs font-medium text-pine"
            >
              + Add set
            </button>
          </div>

          {restLeft != null && (
            <div className="flex items-center gap-3 rounded-[18px] bg-[#e3efe9] px-3.5 py-3">
              <span className="text-lg font-semibold text-[#1f4f43] tabular-nums">{restLeft > 0 ? clock(restLeft) : 'Go'}</span>
              <span className="flex-1 text-xs text-[#26584a]">Rest · started after set {state.restAfter}</span>
              <button
                onClick={() => setState((s) => ({ ...s, restEndsAt: Math.max(s.restEndsAt ?? 0, Date.now()) + 30_000 }))}
                className="text-xs font-semibold text-pine"
              >
                +30s
              </button>
            </div>
          )}

          {next ? (
            <div className="flex items-center gap-3 rounded-[18px] border border-line bg-surface px-3.5 py-3">
              <button onClick={() => goTo(state.index + 1)} className="flex min-w-0 flex-1 flex-col text-left">
                <span className="text-[10px] font-semibold tracking-[0.07em] text-ink-muted">NEXT</span>
                <span className="truncate text-[13px] font-semibold text-ink">
                  {next.name} · {next.sets.length} × {next.targetReps}
                </span>
              </button>
              {next.sets.every((s) => !s.done) && (
                <button onClick={() => setSwapIndex(state.index + 1)} className="text-xs font-medium text-ink-3">
                  Swap
                </button>
              )}
              <button onClick={() => goTo(state.index + 1)} className="text-base text-ink-muted" aria-label="Next exercise">
                ›
              </button>
            </div>
          ) : (
            <button onClick={finish} className="rounded-[18px] bg-pine py-3.5 text-sm font-semibold text-white">
              Finish workout
            </button>
          )}
        </div>
      )}

      {swapIndex !== null && (
        <SwapSheet
          exercises={catalog}
          currentName={state.exercises[swapIndex].name}
          primaryMuscle={catalogByName.get(state.exercises[swapIndex].name.toLowerCase())?.primary_muscle}
          onClose={() => setSwapIndex(null)}
          onPick={(picked) => {
            setState((s) => ({
              ...s,
              exercises: s.exercises.map((e, i) =>
                i !== swapIndex ? e : { ...e, name: picked.name, sets: prefill(picked.name, e.sets.length, e.targetReps, sessions, setsBySession) },
              ),
            }))
            setSwapIndex(null)
          }}
        />
      )}

      <ConfirmDialog
        open={confirmEnd}
        title="End this workout?"
        message="The sets you've ticked are kept. Use Finish instead to see the summary."
        confirmLabel="End"
        onConfirm={end}
        onCancel={() => setConfirmEnd(false)}
      />
    </div>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[10px] font-semibold tracking-[0.07em] text-ink-muted">{children}</span>
      <span className="h-px flex-1 bg-line-strong" />
    </div>
  )
}

/** A set-count bar with the 10–20 target band shaded behind it (scale 0–24). */
export function BandBar({ value, status }: { value: number; status: 'under' | 'in' | 'over' }) {
  const scale = 24
  return (
    <span className="relative h-2.5 flex-1 rounded-full bg-[#ece6da]">
      <span
        className="absolute inset-y-0 bg-[#d4e6dd]"
        style={{ left: `${(SET_TARGET.min / scale) * 100}%`, width: `${((SET_TARGET.max - SET_TARGET.min) / scale) * 100}%` }}
      />
      <span
        className="absolute inset-y-0.5 left-0 rounded-full"
        style={{ width: `${Math.min(100, (value / scale) * 100)}%`, background: status === 'in' ? '#8a6321' : '#c9a55a' }}
      />
    </span>
  )
}
