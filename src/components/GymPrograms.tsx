import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/dates'
import { formatWorkoutDuration } from '../lib/workouts'
import { ConfirmDialog } from './ConfirmDialog'
import type { GymProgram, GymProgramExercise, GymSession, GymSessionSet, Workout } from '../lib/types'

interface ExerciseRow {
  name: string
  sets: string
  reps: string
}

interface SessionExerciseRow {
  exerciseName: string
  sets: { reps: string; weight: string }[]
}

function emptyExerciseRow(): ExerciseRow {
  return { name: '', sets: '3', reps: '10' }
}

function summarizeSet(s: GymSessionSet): string {
  if (s.reps != null && s.weight != null) return `${s.reps}@${s.weight}kg`
  if (s.reps != null) return `${s.reps} reps`
  if (s.weight != null) return `${s.weight}kg`
  return '—'
}

export function GymPrograms({ strengthWorkouts }: { strengthWorkouts: Workout[] }) {
  const [programs, setPrograms] = useState<GymProgram[]>([])
  const [exercisesByProgram, setExercisesByProgram] = useState<Map<string, GymProgramExercise[]>>(new Map())
  const [sessions, setSessions] = useState<GymSession[]>([])
  const [setsBySession, setSetsBySession] = useState<Map<string, GymSessionSet[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [linkingSessionId, setLinkingSessionId] = useState<string | null>(null)
  const [confirmDeleteProgram, setConfirmDeleteProgram] = useState<GymProgram | null>(null)
  const [confirmDeleteSession, setConfirmDeleteSession] = useState<GymSession | null>(null)

  const [builderOpen, setBuilderOpen] = useState(false)
  const [editingProgram, setEditingProgram] = useState<GymProgram | null>(null)
  const [programName, setProgramName] = useState('')
  const [exerciseRows, setExerciseRows] = useState<ExerciseRow[]>([emptyExerciseRow()])

  const [loggingProgram, setLoggingProgram] = useState<GymProgram | null>(null)
  const [editingSession, setEditingSession] = useState<GymSession | null>(null)
  const [sessionDate, setSessionDate] = useState(todayISO())
  const [sessionRows, setSessionRows] = useState<SessionExerciseRow[]>([])

  async function load() {
    setLoading(true)
    const [{ data: programRows }, { data: exerciseRowsData }, { data: sessionRows }] = await Promise.all([
      supabase.from('gym_programs').select('*').order('created_at'),
      supabase.from('gym_program_exercises').select('*').order('position'),
      supabase.from('gym_sessions').select('*').order('date', { ascending: false }).limit(20),
    ])
    const byProgram = new Map<string, GymProgramExercise[]>()
    for (const e of exerciseRowsData ?? []) {
      const arr = byProgram.get(e.program_id) ?? []
      arr.push(e)
      byProgram.set(e.program_id, arr)
    }
    setPrograms(programRows ?? [])
    setExercisesByProgram(byProgram)
    setSessions(sessionRows ?? [])

    const sessionIds = (sessionRows ?? []).map((s) => s.id)
    if (sessionIds.length > 0) {
      const { data: setRows } = await supabase.from('gym_session_sets').select('*').in('session_id', sessionIds)
      const bySession = new Map<string, GymSessionSet[]>()
      for (const s of setRows ?? []) {
        const arr = bySession.get(s.session_id) ?? []
        arr.push(s)
        bySession.set(s.session_id, arr)
      }
      setSetsBySession(bySession)
    } else {
      setSetsBySession(new Map())
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function openBuilder() {
    setEditingProgram(null)
    setProgramName('')
    setExerciseRows([emptyExerciseRow()])
    setBuilderOpen(true)
  }

  function openEditProgram(program: GymProgram) {
    const exercises = (exercisesByProgram.get(program.id) ?? []).slice().sort((a, b) => a.position - b.position)
    setEditingProgram(program)
    setProgramName(program.name)
    setExerciseRows(
      exercises.length > 0
        ? exercises.map((ex) => ({ name: ex.name, sets: String(ex.target_sets), reps: String(ex.target_reps) }))
        : [emptyExerciseRow()],
    )
    setBuilderOpen(true)
  }

  async function saveProgram(e: React.FormEvent) {
    e.preventDefault()
    const name = programName.trim()
    const validRows = exerciseRows.filter((r) => r.name.trim())
    if (!name || validRows.length === 0) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    const exercisePayload = (programId: string) =>
      validRows.map((r, i) => ({
        program_id: programId,
        user_id: user.id,
        name: r.name.trim(),
        target_sets: Number(r.sets) || 1,
        target_reps: Number(r.reps) || 1,
        position: i,
      }))

    if (editingProgram) {
      await supabase.from('gym_programs').update({ name }).eq('id', editingProgram.id)
      // Simplest correct way to reconcile add/remove/rename/reorder: replace the whole
      // exercise list. Sessions reference exercises by name snapshot, not FK, so this
      // can't orphan or corrupt logged history.
      await supabase.from('gym_program_exercises').delete().eq('program_id', editingProgram.id)
      await supabase.from('gym_program_exercises').insert(exercisePayload(editingProgram.id))
    } else {
      const { data: program, error } = await supabase.from('gym_programs').insert({ name, user_id: user.id }).select().single()
      if (error || !program) return
      await supabase.from('gym_program_exercises').insert(exercisePayload(program.id))
    }

    setBuilderOpen(false)
    setEditingProgram(null)
    load()
  }

  async function deleteProgram(program: GymProgram) {
    setPrograms((ps) => ps.filter((p) => p.id !== program.id))
    await supabase.from('gym_programs').delete().eq('id', program.id)
  }

  function openLogSession(program: GymProgram) {
    const exercises = (exercisesByProgram.get(program.id) ?? []).slice().sort((a, b) => a.position - b.position)
    setSessionRows(
      exercises.map((ex) => ({
        exerciseName: ex.name,
        sets: Array.from({ length: ex.target_sets }, () => ({ reps: '', weight: '' })),
      })),
    )
    setSessionDate(todayISO())
    setEditingSession(null)
    setLoggingProgram(program)
  }

  function openEditSession(session: GymSession) {
    const program = session.program_id ? (programs.find((p) => p.id === session.program_id) ?? null) : null
    const programExercises = program ? (exercisesByProgram.get(program.id) ?? []).slice().sort((a, b) => a.position - b.position) : []
    const targetSetsByName = new Map(programExercises.map((ex) => [ex.name, ex.target_sets]))

    const sets = setsBySession.get(session.id) ?? []
    const byExercise = new Map<string, GymSessionSet[]>()
    for (const s of sets) {
      const arr = byExercise.get(s.exercise_name) ?? []
      arr.push(s)
      byExercise.set(s.exercise_name, arr)
    }
    // Show the program's current exercises (so you can log a missed one) plus any
    // exercise names this session logged that the program no longer has.
    const programNames = programExercises.map((ex) => ex.name)
    const exerciseNames = [...programNames, ...[...byExercise.keys()].filter((n) => !programNames.includes(n))]

    setSessionRows(
      exerciseNames.map((name) => {
        const existingSets = (byExercise.get(name) ?? []).slice().sort((a, b) => a.set_number - b.set_number)
        const setCount = Math.max(targetSetsByName.get(name) ?? 0, existingSets.length, 1)
        return {
          exerciseName: name,
          sets: Array.from({ length: setCount }, (_, i) => ({
            reps: existingSets[i]?.reps != null ? String(existingSets[i].reps) : '',
            weight: existingSets[i]?.weight != null ? String(existingSets[i].weight) : '',
          })),
        }
      }),
    )
    setSessionDate(session.date)
    setLoggingProgram(null)
    setEditingSession(session)
  }

  async function saveSession() {
    if (!loggingProgram && !editingSession) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    const sessionId = editingSession
      ? editingSession.id
      : await (async () => {
          if (!loggingProgram) return null
          const { data: session, error } = await supabase
            .from('gym_sessions')
            .insert({ user_id: user.id, program_id: loggingProgram.id, program_name: loggingProgram.name, date: sessionDate })
            .select()
            .single()
          return error || !session ? null : session.id
        })()
    if (!sessionId) return

    if (editingSession) {
      await supabase.from('gym_sessions').update({ date: sessionDate }).eq('id', sessionId)
      await supabase.from('gym_session_sets').delete().eq('session_id', sessionId)
    }

    const setsToInsert = sessionRows.flatMap((row) =>
      row.sets
        .map((s, i) => ({ ...s, set_number: i + 1 }))
        .filter((s) => s.reps || s.weight)
        .map((s) => ({
          user_id: user.id,
          session_id: sessionId,
          exercise_name: row.exerciseName,
          set_number: s.set_number,
          reps: s.reps ? Number(s.reps) : null,
          weight: s.weight ? Number(s.weight) : null,
        })),
    )
    if (setsToInsert.length > 0) await supabase.from('gym_session_sets').insert(setsToInsert)

    setLoggingProgram(null)
    setEditingSession(null)
    load()
  }

  async function deleteSession(session: GymSession) {
    setSessions((ss) => ss.filter((s) => s.id !== session.id))
    await supabase.from('gym_sessions').delete().eq('id', session.id)
  }

  async function linkSession(session: GymSession, workout: Workout) {
    setSessions((ss) => ss.map((s) => (s.id === session.id ? { ...s, strava_workout_id: workout.id } : s)))
    setLinkingSessionId(null)
    await supabase.from('gym_sessions').update({ strava_workout_id: workout.id }).eq('id', session.id)
  }

  async function unlinkSession(session: GymSession) {
    setSessions((ss) => ss.map((s) => (s.id === session.id ? { ...s, strava_workout_id: null } : s)))
    await supabase.from('gym_sessions').update({ strava_workout_id: null }).eq('id', session.id)
  }

  const workoutById = new Map(strengthWorkouts.map((w) => [w.id, w]))
  const linkedWorkoutIds = new Set(sessions.map((s) => s.strava_workout_id).filter((id): id is string => id != null))

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-gray-500">Your programs</h2>
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {programs.map((program) => {
            const exercises = (exercisesByProgram.get(program.id) ?? []).slice().sort((a, b) => a.position - b.position)
            return (
              <div
                key={program.id}
                className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm"
              >
                <button onClick={() => openLogSession(program)} className="flex-1 text-left">
                  <p className="font-medium text-gray-900">{program.name}</p>
                  <p className="text-[11px] text-gray-400">
                    {exercises.length} exercise{exercises.length === 1 ? '' : 's'} — tap to log
                  </p>
                </button>
                <button onClick={() => openEditProgram(program)} className="pl-3 text-gray-300" aria-label="Edit program">
                  ✎
                </button>
                <button onClick={() => setConfirmDeleteProgram(program)} className="pl-3 text-gray-300" aria-label="Remove program">
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}
      <button
        onClick={openBuilder}
        className="rounded-2xl border-2 border-dashed border-gray-200 py-2.5 text-sm font-semibold text-rose-600"
      >
        + New program
      </button>

      {sessions.length > 0 && (
        <div className="mt-2">
          <h2 className="mb-2 text-sm font-semibold text-gray-500">Recent sessions</h2>
          <ul className="flex flex-col gap-2">
            {sessions.map((session) => {
              const sets = setsBySession.get(session.id) ?? []
              const byExercise = new Map<string, GymSessionSet[]>()
              for (const s of sets) {
                const arr = byExercise.get(s.exercise_name) ?? []
                arr.push(s)
                byExercise.set(s.exercise_name, arr)
              }
              return (
                <li key={session.id} className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{session.program_name ?? 'Session'}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-400">{session.date}</span>
                      <button onClick={() => openEditSession(session)} className="text-gray-300" aria-label="Edit session">
                        ✎
                      </button>
                      <button onClick={() => setConfirmDeleteSession(session)} className="text-gray-300" aria-label="Remove session">
                        ✕
                      </button>
                    </div>
                  </div>
                  {[...byExercise.entries()].map(([name, exSets]) => (
                    <p key={name} className="mt-1 text-[11px] text-gray-500">
                      <span className="font-medium text-gray-700">{name}:</span>{' '}
                      {exSets
                        .sort((a, b) => a.set_number - b.set_number)
                        .map(summarizeSet)
                        .join(', ')}
                    </p>
                  ))}

                  {session.strava_workout_id ? (
                    (() => {
                      const linkedWorkout = workoutById.get(session.strava_workout_id)
                      return (
                        <div className="mt-2 flex items-center justify-between rounded-xl bg-orange-50 px-2.5 py-1.5">
                          <span className="text-[11px] text-orange-600">
                            🔗 {linkedWorkout ? `${linkedWorkout.name} · ${formatWorkoutDuration(linkedWorkout.duration_seconds)}` : 'Linked'}
                          </span>
                          <button onClick={() => unlinkSession(session)} className="text-[11px] font-medium text-gray-400">
                            Unlink
                          </button>
                        </div>
                      )
                    })()
                  ) : linkingSessionId === session.id ? (
                    (() => {
                      const candidates = strengthWorkouts
                        .filter((w) => !linkedWorkoutIds.has(w.id))
                        .sort(
                          (a, b) =>
                            Math.abs(new Date(a.date).getTime() - new Date(session.date).getTime()) -
                            Math.abs(new Date(b.date).getTime() - new Date(session.date).getTime()),
                        )
                        .slice(0, 5)
                      return (
                        <div className="mt-2 flex flex-col gap-1 rounded-xl bg-gray-50 p-2">
                          {candidates.length === 0 ? (
                            <p className="text-[11px] text-gray-400">No unlinked Strava workouts found yet.</p>
                          ) : (
                            candidates.map((w) => (
                              <button
                                key={w.id}
                                onClick={() => linkSession(session, w)}
                                className="rounded-lg bg-white px-2 py-1.5 text-left text-[11px] text-gray-700 shadow-sm"
                              >
                                {w.date} · {w.name} · {formatWorkoutDuration(w.duration_seconds)}
                              </button>
                            ))
                          )}
                          <button
                            onClick={() => setLinkingSessionId(null)}
                            className="text-left text-[11px] font-medium text-gray-400"
                          >
                            Cancel
                          </button>
                        </div>
                      )
                    })()
                  ) : (
                    <button
                      onClick={() => setLinkingSessionId(session.id)}
                      className="mt-2 text-[11px] font-medium text-rose-600"
                    >
                      Link to Strava workout
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {builderOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-gray-900">{editingProgram ? 'Edit program' : 'New program'}</h2>
            <button
              onClick={() => {
                setBuilderOpen(false)
                setEditingProgram(null)
              }}
              className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600"
            >
              Close ✕
            </button>
          </div>
          <form onSubmit={saveProgram} className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
            <input
              autoFocus
              value={programName}
              onChange={(e) => setProgramName(e.target.value)}
              placeholder="Program name, e.g. Push Day"
              className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-rose-400"
            />
            <div className="flex flex-col gap-2">
              {exerciseRows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={row.name}
                    onChange={(e) =>
                      setExerciseRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, name: e.target.value } : r)))
                    }
                    placeholder="Exercise, e.g. Bench Press"
                    className="min-w-0 flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-rose-400"
                  />
                  <input
                    value={row.sets}
                    onChange={(e) =>
                      setExerciseRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, sets: e.target.value } : r)))
                    }
                    type="number"
                    placeholder="Sets"
                    className="w-16 min-w-0 rounded-2xl border border-gray-200 bg-white px-2 py-2.5 text-center text-gray-900 placeholder-gray-400 outline-none focus:border-rose-400"
                  />
                  <input
                    value={row.reps}
                    onChange={(e) =>
                      setExerciseRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, reps: e.target.value } : r)))
                    }
                    type="number"
                    placeholder="Reps"
                    className="w-16 min-w-0 rounded-2xl border border-gray-200 bg-white px-2 py-2.5 text-center text-gray-900 placeholder-gray-400 outline-none focus:border-rose-400"
                  />
                  <button
                    type="button"
                    onClick={() => setExerciseRows((rows) => rows.filter((_, idx) => idx !== i))}
                    className="shrink-0 px-2 text-gray-300"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setExerciseRows((rows) => [...rows, emptyExerciseRow()])}
              className="rounded-2xl border-2 border-dashed border-gray-200 py-2 text-sm font-semibold text-rose-600"
            >
              + Add exercise
            </button>
            <button type="submit" className="mt-2 rounded-2xl bg-rose-600 px-4 py-2.5 font-semibold text-white">
              {editingProgram ? 'Save changes' : 'Save program'}
            </button>
          </form>
        </div>
      )}

      {(loggingProgram || editingSession) && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-gray-900">
              {editingSession ? (editingSession.program_name ?? 'Session') : loggingProgram!.name}
            </h2>
            <button
              onClick={() => {
                setLoggingProgram(null)
                setEditingSession(null)
              }}
              className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600"
            >
              Close ✕
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            <input
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              type="date"
              className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 outline-none focus:border-rose-400"
            />
            {sessionRows.map((row, exIdx) => (
              <div key={exIdx} className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
                <p className="mb-2 font-medium text-gray-900">{row.exerciseName}</p>
                <div className="flex flex-col gap-1.5">
                  {row.sets.map((set, setIdx) => (
                    <div key={setIdx} className="flex items-center gap-2">
                      <span className="w-12 shrink-0 text-xs text-gray-400">Set {setIdx + 1}</span>
                      <input
                        value={set.reps}
                        onChange={(e) =>
                          setSessionRows((rows) =>
                            rows.map((r, ri) =>
                              ri === exIdx
                                ? { ...r, sets: r.sets.map((s, si) => (si === setIdx ? { ...s, reps: e.target.value } : s)) }
                                : r,
                            ),
                          )
                        }
                        type="number"
                        placeholder="Reps"
                        className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 outline-none focus:border-rose-400"
                      />
                      <input
                        value={set.weight}
                        onChange={(e) =>
                          setSessionRows((rows) =>
                            rows.map((r, ri) =>
                              ri === exIdx
                                ? { ...r, sets: r.sets.map((s, si) => (si === setIdx ? { ...s, weight: e.target.value } : s)) }
                                : r,
                            ),
                          )
                        }
                        type="number"
                        step="0.5"
                        placeholder="kg"
                        className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 outline-none focus:border-rose-400"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <button onClick={saveSession} className="mt-2 rounded-2xl bg-rose-600 px-4 py-2.5 font-semibold text-white">
              {editingSession ? 'Save changes' : 'Save session'}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteProgram !== null}
        title={`Remove "${confirmDeleteProgram?.name ?? ''}"?`}
        message="This deletes the program and its exercise list. Logged sessions are kept."
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirmDeleteProgram) deleteProgram(confirmDeleteProgram)
          setConfirmDeleteProgram(null)
        }}
        onCancel={() => setConfirmDeleteProgram(null)}
      />

      <ConfirmDialog
        open={confirmDeleteSession !== null}
        title="Remove this session?"
        message="This deletes the logged sets for this session. It can't be undone."
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirmDeleteSession) deleteSession(confirmDeleteSession)
          setConfirmDeleteSession(null)
        }}
        onCancel={() => setConfirmDeleteSession(null)}
      />
    </div>
  )
}
