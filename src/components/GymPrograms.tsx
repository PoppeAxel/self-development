import { Fragment, useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/dates'
import { formatWorkoutDuration } from '../lib/workouts'
import { MUSCLE_GROUPS, MUSCLE_REGIONS, TRACKED_LIFTS, estimatedOneRepMax, recentAverage, liftTrendPerWeek } from '../lib/exercises'
import { ConfirmDialog } from './ConfirmDialog'
import type { Exercise, GymProgram, GymProgramExercise, GymSession, GymSessionSet, Workout } from '../lib/types'

interface ExerciseRow {
  name: string
  sets: string
  reps: string
  primaryMuscle: string
  secondaryMuscle: string
}

interface SessionExerciseRow {
  exerciseName: string
  sets: { reps: string; weight: string }[]
}

function emptyExerciseRow(): ExerciseRow {
  return { name: '', sets: '3', reps: '10', primaryMuscle: '', secondaryMuscle: '' }
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
  const [exercises, setExercises] = useState<Exercise[]>([])

  const [builderOpen, setBuilderOpen] = useState(false)
  const [editingProgram, setEditingProgram] = useState<GymProgram | null>(null)
  const [programName, setProgramName] = useState('')
  const [exerciseRows, setExerciseRows] = useState<ExerciseRow[]>([emptyExerciseRow()])
  const [substitutingIndex, setSubstitutingIndex] = useState<number | null>(null)
  const [substituteQuery, setSubstituteQuery] = useState('')

  const [loggingProgram, setLoggingProgram] = useState<GymProgram | null>(null)
  const [editingSession, setEditingSession] = useState<GymSession | null>(null)
  const [sessionDate, setSessionDate] = useState(todayISO())
  const [sessionRows, setSessionRows] = useState<SessionExerciseRow[]>([])
  const [substitutingSessionIndex, setSubstitutingSessionIndex] = useState<number | null>(null)
  const [substituteSessionQuery, setSubstituteSessionQuery] = useState('')
  const [addingExercise, setAddingExercise] = useState(false)
  const [addExerciseQuery, setAddExerciseQuery] = useState('')
  const [addToProgramToo, setAddToProgramToo] = useState(false)

  const [libraryOpen, setLibraryOpen] = useState(false)
  const [exerciseFormOpen, setExerciseFormOpen] = useState(false)
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null)
  const [exerciseFormName, setExerciseFormName] = useState('')
  const [exerciseFormPrimary, setExerciseFormPrimary] = useState('')
  const [exerciseFormSecondary, setExerciseFormSecondary] = useState('')
  const [confirmDeleteExercise, setConfirmDeleteExercise] = useState<Exercise | null>(null)
  const [programsOpen, setProgramsOpen] = useState(false)
  const [expandedRegion, setExpandedRegion] = useState<string | null>(null)
  const [sessionsOpen, setSessionsOpen] = useState(false)

  async function load() {
    setLoading(true)
    const [{ data: programRows }, { data: exerciseRowsData }, { data: sessionRows }, { data: exerciseCatalogRows }] = await Promise.all([
      supabase.from('gym_programs').select('*').order('created_at'),
      supabase.from('gym_program_exercises').select('*').order('position'),
      supabase.from('gym_sessions').select('*').order('date', { ascending: false }).limit(20),
      supabase.from('exercises').select('*').order('name'),
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
    setExercises(exerciseCatalogRows ?? [])

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
    const progExercises = (exercisesByProgram.get(program.id) ?? []).slice().sort((a, b) => a.position - b.position)
    const exerciseById = new Map(exercises.map((ex) => [ex.id, ex]))
    const exerciseByName = new Map(exercises.map((ex) => [ex.name.toLowerCase(), ex]))
    setEditingProgram(program)
    setProgramName(program.name)
    setExerciseRows(
      progExercises.length > 0
        ? progExercises.map((ex) => {
            const catalogEx = ex.exercise_id ? exerciseById.get(ex.exercise_id) : exerciseByName.get(ex.name.toLowerCase())
            return {
              name: ex.name,
              sets: String(ex.target_sets),
              reps: String(ex.target_reps),
              primaryMuscle: catalogEx?.primary_muscle ?? '',
              secondaryMuscle: catalogEx?.secondary_muscle ?? '',
            }
          })
        : [emptyExerciseRow()],
    )
    setBuilderOpen(true)
  }

  // Upserts the row's name into the exercise catalog with its chosen muscle groups (or
  // clears them if left blank) and returns the catalog id to link on the program row.
  async function upsertExercise(userId: string, name: string, primaryMuscle: string, secondaryMuscle: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('exercises')
      .upsert(
        { user_id: userId, name, primary_muscle: primaryMuscle || null, secondary_muscle: secondaryMuscle || null },
        { onConflict: 'user_id,name' },
      )
      .select('id')
      .single()
    return error || !data ? null : data.id
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

    const exerciseIds = await Promise.all(
      validRows.map((r) => upsertExercise(user.id, r.name.trim(), r.primaryMuscle, r.secondaryMuscle)),
    )

    const exercisePayload = (programId: string) =>
      validRows.map((r, i) => ({
        program_id: programId,
        user_id: user.id,
        name: r.name.trim(),
        target_sets: Number(r.sets) || 1,
        target_reps: Number(r.reps) || 1,
        position: i,
        exercise_id: exerciseIds[i],
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

  function openNewExercise() {
    setEditingExercise(null)
    setExerciseFormName('')
    setExerciseFormPrimary('')
    setExerciseFormSecondary('')
    setExerciseFormOpen(true)
  }

  function openEditExercise(ex: Exercise) {
    setEditingExercise(ex)
    setExerciseFormName(ex.name)
    setExerciseFormPrimary(ex.primary_muscle ?? '')
    setExerciseFormSecondary(ex.secondary_muscle ?? '')
    setExerciseFormOpen(true)
  }

  async function saveExerciseForm(e: React.FormEvent) {
    e.preventDefault()
    const name = exerciseFormName.trim()
    if (!name) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    if (editingExercise) {
      await supabase
        .from('exercises')
        .update({ name, primary_muscle: exerciseFormPrimary || null, secondary_muscle: exerciseFormSecondary || null })
        .eq('id', editingExercise.id)
      // gym_program_exercises.name is denormalized for display, so a rename here
      // needs to propagate to current programs — gym_session_sets.exercise_name is
      // an intentional historical snapshot (same reasoning as program_name) and is
      // left untouched.
      if (name !== editingExercise.name) {
        await supabase.from('gym_program_exercises').update({ name }).eq('exercise_id', editingExercise.id)
      }
    } else {
      await supabase
        .from('exercises')
        .upsert(
          { user_id: user.id, name, primary_muscle: exerciseFormPrimary || null, secondary_muscle: exerciseFormSecondary || null },
          { onConflict: 'user_id,name' },
        )
    }

    setExerciseFormOpen(false)
    setEditingExercise(null)
    load()
  }

  async function deleteExercise(ex: Exercise) {
    setExercises((es) => es.filter((e) => e.id !== ex.id))
    await supabase.from('exercises').delete().eq('id', ex.id)
  }

  // Most recent logged sets for an exercise (by name, case-insensitive), searching
  // sessions newest-first — used to prefill "last time you did this" reps/weight.
  function lastLoggedSets(exerciseName: string): GymSessionSet[] | null {
    const target = exerciseName.toLowerCase()
    for (const session of sessions) {
      const sets = (setsBySession.get(session.id) ?? []).filter((s) => s.exercise_name.toLowerCase() === target)
      if (sets.length > 0) return sets.slice().sort((a, b) => a.set_number - b.set_number)
    }
    return null
  }

  // Estimated 1-rep-max per session for a tracked lift, ascending by date — the best
  // (highest e1RM) set that session, so different rep ranges stay comparable over time.
  function liftProgress(exerciseName: string): { date: string; e1rm: number }[] {
    const target = exerciseName.toLowerCase()
    const points: { date: string; e1rm: number }[] = []
    for (const session of sessions) {
      const sets = (setsBySession.get(session.id) ?? []).filter(
        (s) => s.exercise_name.toLowerCase() === target && s.weight != null && s.reps != null,
      )
      if (sets.length === 0) continue
      const best = Math.max(...sets.map((s) => estimatedOneRepMax(s.weight as number, s.reps as number)))
      points.push({ date: session.date, e1rm: Math.round(best * 10) / 10 })
    }
    return points.sort((a, b) => a.date.localeCompare(b.date))
  }

  // Rolling average sets/week per muscle group over the trailing window, so a single
  // heavy or light week doesn't misrepresent how balanced training actually is. A set
  // counts fully toward its exercise's primary muscle and at half weight toward its
  // secondary muscle (the common convention for indirect stimulus, e.g. rows for biceps).
  function muscleBalance(windowDays: number): { muscle: string; primaryPerWeek: number; secondaryPerWeek: number; totalPerWeek: number }[] {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - windowDays)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const totals = new Map<string, { primary: number; secondary: number }>()
    for (const session of sessions) {
      if (session.date < cutoffStr) continue
      for (const s of setsBySession.get(session.id) ?? []) {
        const ex = exerciseByName.get(s.exercise_name.toLowerCase())
        if (!ex) continue
        if (ex.primary_muscle) {
          const t = totals.get(ex.primary_muscle) ?? { primary: 0, secondary: 0 }
          t.primary += 1
          totals.set(ex.primary_muscle, t)
        }
        if (ex.secondary_muscle) {
          const t = totals.get(ex.secondary_muscle) ?? { primary: 0, secondary: 0 }
          t.secondary += 1
          totals.set(ex.secondary_muscle, t)
        }
      }
    }
    const weeks = windowDays / 7
    return MUSCLE_GROUPS.map((muscle) => {
      const t = totals.get(muscle) ?? { primary: 0, secondary: 0 }
      return {
        muscle,
        primaryPerWeek: t.primary / weeks,
        secondaryPerWeek: (t.secondary * 0.5) / weeks,
        totalPerWeek: (t.primary + t.secondary * 0.5) / weeks,
      }
    }).sort((a, b) => b.totalPerWeek - a.totalPerWeek)
  }

  function openLogSession(program: GymProgram) {
    const progExercises = (exercisesByProgram.get(program.id) ?? []).slice().sort((a, b) => a.position - b.position)
    setSessionRows(
      progExercises.map((ex) => {
        const previous = lastLoggedSets(ex.name)
        return {
          exerciseName: ex.name,
          sets: Array.from({ length: ex.target_sets }, (_, i) => ({
            reps: previous?.[i]?.reps != null ? String(previous[i].reps) : '',
            weight: previous?.[i]?.weight != null ? String(previous[i].weight) : '',
          })),
        }
      }),
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

  // Replaces a session row's exercise in place (e.g. equipment unavailable, an injury) —
  // this only affects the session being logged, not the underlying program. To log an
  // extra exercise without losing the original, use "+ Add exercise" instead of swapping.
  function pickSubstituteForSession(newExerciseName: string) {
    if (substitutingSessionIndex == null) return
    const previous = lastLoggedSets(newExerciseName)
    setSessionRows((rows) =>
      rows.map((r, idx) => {
        if (idx !== substitutingSessionIndex) return r
        return {
          exerciseName: newExerciseName,
          sets: Array.from({ length: r.sets.length }, (_, i) => ({
            reps: previous?.[i]?.reps != null ? String(previous[i].reps) : '',
            weight: previous?.[i]?.weight != null ? String(previous[i].weight) : '',
          })),
        }
      }),
    )
    setSubstitutingSessionIndex(null)
  }

  // The program a session belongs to, if any — a brand-new session logs against
  // `loggingProgram`, an existing one carries `editingSession.program_id` (nullable, since
  // a session can outlive its program being deleted). Used to offer "also add to the
  // program" when adding an ad-hoc exercise mid-session.
  function sessionProgram(): GymProgram | null {
    if (loggingProgram) return loggingProgram
    if (editingSession?.program_id) return programs.find((p) => p.id === editingSession.program_id) ?? null
    return null
  }

  // Adds an exercise to just this session (3 blank sets, same starting point as a new
  // program row) without touching anything else already logged. Optionally also persists
  // it onto the underlying program's exercise list so it shows up automatically next time.
  async function addExerciseToSession(name: string, alsoAddToProgram: boolean) {
    setSessionRows((rows) => [...rows, { exerciseName: name, sets: Array.from({ length: 3 }, () => ({ reps: '', weight: '' })) }])
    setAddingExercise(false)

    const program = alsoAddToProgram ? sessionProgram() : null
    if (!program) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const exerciseId = await upsertExercise(user.id, name, '', '')
    const position = (exercisesByProgram.get(program.id) ?? []).length
    await supabase.from('gym_program_exercises').insert({
      program_id: program.id,
      user_id: user.id,
      name,
      target_sets: 3,
      target_reps: 10,
      position,
      exercise_id: exerciseId,
    })
    load()
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
  const exerciseByName = new Map(exercises.map((ex) => [ex.name.toLowerCase(), ex]))

  const trackedLiftProgress = TRACKED_LIFTS.map((name) => ({ name, points: liftProgress(name) })).filter(
    (lift) => lift.points.length > 0,
  )
  const muscleBalanceWindowDays = 28
  const muscleBalanceData = muscleBalance(muscleBalanceWindowDays)
  const muscleByName = new Map(muscleBalanceData.map((m) => [m.muscle, m]))
  const regionBalance = Object.entries(MUSCLE_REGIONS)
    .map(([region, muscles]) => {
      const items = muscles.map((m) => muscleByName.get(m)!).filter(Boolean)
      return { region, items, totalPerWeek: items.reduce((sum, m) => sum + m.totalPerWeek, 0) }
    })
    .sort((a, b) => b.totalPerWeek - a.totalPerWeek)
  const regionMax = Math.max(...regionBalance.map((r) => r.totalPerWeek), 1)
  const muscleBalanceMax = Math.max(...muscleBalanceData.map((m) => m.totalPerWeek), 1)

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-ink-3">Lift progress</h2>
      {trackedLiftProgress.length === 0 ? (
        <p className="text-sm text-ink-disabled">
          Log weight and reps for Squat, Bench press, Deadlift, or Military press (overhead press) to see your estimated 1-rep-max
          trend here.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {trackedLiftProgress.map(({ name, points }) => {
            // Averaging the last few sessions (rather than just the latest) keeps one
            // off day — poor sleep, fatigue — from swinging the headline number, and the
            // trend below is a regression across every session rather than two isolated
            // points, for the same reason.
            const windowSize = Math.min(3, points.length)
            const current = recentAverage(points, windowSize)
            const trend = liftTrendPerWeek(points)
            return (
              <div key={name} className="rounded-[20px] border border-line bg-surface p-3 shadow-card">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-ink">{name}</p>
                  <div className="text-right">
                    <p className="text-sm font-bold text-ink">{current.toFixed(1)} kg e1RM</p>
                    <p className="text-[11px] text-ink-disabled">
                      {points.length > 1 ? `avg of last ${windowSize} session${windowSize === 1 ? '' : 's'}` : '1 session logged'}
                    </p>
                    {trend !== null ? (
                      <p
                        className={`text-xs font-semibold ${
                          Math.abs(trend) < 0.05 ? 'text-ink-disabled' : trend > 0 ? 'text-cat-emerald-ink' : 'text-cat-rose-ink'
                        }`}
                      >
                        {trend > 0 ? '↗' : trend < 0 ? '↘' : '→'} {Math.abs(trend).toFixed(1)} kg/wk
                      </p>
                    ) : points.length < 3 ? (
                      <p className="text-[11px] text-ink-disabled">
                        Log {3 - points.length} more session{3 - points.length === 1 ? '' : 's'} for a trend
                      </p>
                    ) : (
                      <p className="text-[11px] text-ink-disabled">Not enough date spread yet for a trend</p>
                    )}
                  </div>
                </div>
                {points.length > 1 && (
                  <div className="mt-2 h-24">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eae3d5" />
                        <XAxis dataKey="date" stroke="#8b8577" fontSize={10} tickFormatter={(d: string) => d.slice(5)} />
                        <YAxis stroke="#8b8577" fontSize={10} domain={['dataMin - 5', 'dataMax + 5']} width={32} />
                        <Tooltip
                          contentStyle={{ background: '#fdfbf6', border: '1px solid #e9e2d4', fontSize: 12, borderRadius: 12, color: '#23241f' }}
                          formatter={(value) => [`${value} kg`, 'e1RM']}
                        />
                        <Line type="monotone" dataKey="e1rm" stroke="#a8563f" strokeWidth={2.5} dot={{ r: 3, fill: '#a8563f' }} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-ink-3">Muscle balance</h2>
        <p className="mb-2 text-[11px] text-ink-disabled">
          Avg sets/week, last {muscleBalanceWindowDays / 7} weeks · secondary muscles (lighter) count half a set · tap a region for detail
        </p>
        {muscleBalanceData.every((m) => m.totalPerWeek === 0) ? (
          <p className="text-sm text-ink-disabled">Log some sessions with categorized exercises to see your balance across muscle groups.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {regionBalance.map(({ region, items, totalPerWeek }) => (
              <div key={region}>
                <button
                  type="button"
                  onClick={() => setExpandedRegion((r) => (r === region ? null : region))}
                  className="flex w-full items-center gap-2"
                >
                  <span className="w-20 shrink-0 text-left text-xs font-medium text-ink-2">{region}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded-full bg-track">
                    <div className="flex h-full">
                      {items.map((m) => (
                        <Fragment key={m.muscle}>
                          <div className="h-full bg-cat-pink" style={{ width: `${(m.primaryPerWeek / regionMax) * 100}%` }} />
                          <div className="h-full bg-cat-pink-tint" style={{ width: `${(m.secondaryPerWeek / regionMax) * 100}%` }} />
                        </Fragment>
                      ))}
                    </div>
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs font-medium text-ink-2">{totalPerWeek.toFixed(1)}</span>
                  <span className="w-3 shrink-0 text-ink-disabled">{expandedRegion === region ? '▲' : '▼'}</span>
                </button>
                {expandedRegion === region && (
                  <div className="mt-2 ml-4 flex flex-col gap-1.5 border-l-2 border-line pl-3">
                    {items.map((m) => (
                      <div key={m.muscle} className="flex items-center gap-2">
                        <span className="w-24 shrink-0 text-xs text-ink-3">{m.muscle}</span>
                        <div className="h-3 flex-1 overflow-hidden rounded-full bg-track">
                          <div className="flex h-full">
                            <div className="h-full bg-cat-pink" style={{ width: `${(m.primaryPerWeek / muscleBalanceMax) * 100}%` }} />
                            <div className="h-full bg-cat-pink-tint" style={{ width: `${(m.secondaryPerWeek / muscleBalanceMax) * 100}%` }} />
                          </div>
                        </div>
                        <span className="w-8 shrink-0 text-right text-xs text-ink-3">{m.totalPerWeek.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={() => setProgramsOpen((o) => !o)}
        className="flex items-center justify-between text-sm font-semibold text-ink-3"
      >
        <span>Your programs ({programs.length})</span>
        <span className="text-ink-disabled">{programsOpen ? 'Hide ▲' : 'Show ▼'}</span>
      </button>
      {programsOpen && (loading ? (
        <p className="text-sm text-ink-disabled">Loading…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {programs.map((program) => {
            const exercises = (exercisesByProgram.get(program.id) ?? []).slice().sort((a, b) => a.position - b.position)
            return (
              <div
                key={program.id}
                className="flex items-center justify-between rounded-[20px] border border-line bg-surface px-4 py-3 shadow-card"
              >
                <button onClick={() => openLogSession(program)} className="flex-1 text-left">
                  <p className="font-medium text-ink">{program.name}</p>
                  <p className="text-[11px] text-ink-disabled">
                    {exercises.length} exercise{exercises.length === 1 ? '' : 's'} — tap to log
                  </p>
                </button>
                <button onClick={() => openEditProgram(program)} className="pl-3 text-ink-faint" aria-label="Edit program">
                  ✎
                </button>
                <button onClick={() => setConfirmDeleteProgram(program)} className="pl-3 text-ink-faint" aria-label="Remove program">
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      ))}
      <button
        onClick={openBuilder}
        className="rounded-[20px] border border-line-strong bg-surface py-3 text-sm font-semibold text-pine"
      >
        + New program
      </button>
      <button onClick={() => setLibraryOpen(true)} className="text-sm font-medium text-ink-3">
        📋 Exercise library ({exercises.length})
      </button>

      {sessions.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setSessionsOpen((o) => !o)}
            className="mb-2 flex w-full items-center justify-between text-sm font-semibold text-ink-3"
          >
            <span>Recent sessions ({sessions.length})</span>
            <span className="text-ink-disabled">{sessionsOpen ? 'Hide ▲' : 'Show ▼'}</span>
          </button>
          {sessionsOpen && (
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
                <li key={session.id} className="rounded-[20px] border border-line bg-surface px-4 py-3 shadow-card">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-ink">{session.program_name ?? 'Session'}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-ink-disabled">{session.date}</span>
                      <button onClick={() => openEditSession(session)} className="text-ink-faint" aria-label="Edit session">
                        ✎
                      </button>
                      <button onClick={() => setConfirmDeleteSession(session)} className="text-ink-faint" aria-label="Remove session">
                        ✕
                      </button>
                    </div>
                  </div>
                  {[...byExercise.entries()].map(([name, exSets]) => (
                    <p key={name} className="mt-1 text-[11px] text-ink-3">
                      <span className="font-medium text-ink-2">{name}:</span>{' '}
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
                        <div className="mt-2 flex items-center justify-between rounded-xl bg-cat-amber-tint px-2.5 py-1.5">
                          <span className="text-[11px] text-cat-amber-ink">
                            🔗 {linkedWorkout ? `${linkedWorkout.name} · ${formatWorkoutDuration(linkedWorkout.duration_seconds)}` : 'Linked'}
                          </span>
                          <button onClick={() => unlinkSession(session)} className="text-[11px] font-medium text-ink-disabled">
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
                        <div className="mt-2 flex flex-col gap-1 rounded-xl bg-track p-2">
                          {candidates.length === 0 ? (
                            <p className="text-[11px] text-ink-disabled">No unlinked Strava workouts found yet.</p>
                          ) : (
                            candidates.map((w) => (
                              <button
                                key={w.id}
                                onClick={() => linkSession(session, w)}
                                className="rounded-lg bg-surface px-2 py-1.5 text-left text-[11px] text-ink-2 shadow-card"
                              >
                                {w.date} · {w.name} · {formatWorkoutDuration(w.duration_seconds)}
                              </button>
                            ))
                          )}
                          <button
                            onClick={() => setLinkingSessionId(null)}
                            className="text-left text-[11px] font-medium text-ink-disabled"
                          >
                            Cancel
                          </button>
                        </div>
                      )
                    })()
                  ) : (
                    <button
                      onClick={() => setLinkingSessionId(session.id)}
                      className="mt-2 text-[11px] font-medium text-cat-rose-ink"
                    >
                      Link to Strava workout
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          )}
        </div>
      )}

      {builderOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-page safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-ink">{editingProgram ? 'Edit program' : 'New program'}</h2>
            <button
              onClick={() => {
                setBuilderOpen(false)
                setEditingProgram(null)
              }}
              className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2"
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
              className="rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
            />
            <div className="flex flex-col gap-2">
              {exerciseRows.map((row, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-[20px] border border-line p-3">
                  <div className="flex gap-2">
                    <input
                      value={row.name}
                      onChange={(e) =>
                        setExerciseRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, name: e.target.value } : r)))
                      }
                      placeholder="Exercise, e.g. Bench Press"
                      className="min-w-0 flex-1 rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setSubstitutingIndex(i)
                        setSubstituteQuery('')
                      }}
                      className="shrink-0 px-2 text-ink-disabled"
                      aria-label="Swap exercise"
                    >
                      ⇄
                    </button>
                    <button
                      type="button"
                      onClick={() => setExerciseRows((rows) => rows.filter((_, idx) => idx !== i))}
                      className="shrink-0 px-2 text-ink-faint"
                      aria-label="Remove exercise"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={row.sets}
                      onChange={(e) =>
                        setExerciseRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, sets: e.target.value } : r)))
                      }
                      type="number"
                      placeholder="Sets"
                      className="w-16 min-w-0 rounded-[20px] border border-line-strong bg-surface px-2 py-2.5 text-center text-ink placeholder-ink-disabled outline-none focus:border-pine"
                    />
                    <input
                      value={row.reps}
                      onChange={(e) =>
                        setExerciseRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, reps: e.target.value } : r)))
                      }
                      type="number"
                      placeholder="Reps"
                      className="w-16 min-w-0 rounded-[20px] border border-line-strong bg-surface px-2 py-2.5 text-center text-ink placeholder-ink-disabled outline-none focus:border-pine"
                    />
                    <select
                      value={row.primaryMuscle}
                      onChange={(e) =>
                        setExerciseRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, primaryMuscle: e.target.value } : r)))
                      }
                      className="min-w-0 flex-1 rounded-[20px] border border-line-strong bg-surface px-2 py-2.5 text-sm text-ink outline-none focus:border-pine"
                    >
                      <option value="">Primary muscle</option>
                      {MUSCLE_GROUPS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <select
                      value={row.secondaryMuscle}
                      onChange={(e) =>
                        setExerciseRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, secondaryMuscle: e.target.value } : r)))
                      }
                      className="min-w-0 flex-1 rounded-[20px] border border-line-strong bg-surface px-2 py-2.5 text-sm text-ink outline-none focus:border-pine"
                    >
                      <option value="">Secondary (optional)</option>
                      {MUSCLE_GROUPS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setExerciseRows((rows) => [...rows, emptyExerciseRow()])}
              className="rounded-[20px] border border-line-strong bg-surface py-2.5 text-sm font-semibold text-pine"
            >
              + Add exercise
            </button>
            <button type="submit" className="mt-2 rounded-[20px] bg-pine px-4 py-2.5 font-semibold text-white">
              {editingProgram ? 'Save changes' : 'Save program'}
            </button>
          </form>

          {substitutingIndex !== null && (
            <div className="fixed inset-0 z-[60] flex flex-col bg-page safe-top safe-bottom">
              <div className="flex items-center justify-between px-4 pt-4">
                <h2 className="text-lg font-bold text-ink">Swap exercise</h2>
                <button
                  onClick={() => setSubstitutingIndex(null)}
                  className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2"
                >
                  Close ✕
                </button>
              </div>
              <div className="p-4">
                <input
                  autoFocus
                  value={substituteQuery}
                  onChange={(e) => setSubstituteQuery(e.target.value)}
                  placeholder="Search exercises"
                  className="w-full rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
                />
              </div>
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                {(() => {
                  const currentRow = exerciseRows[substitutingIndex]
                  const query = substituteQuery.trim().toLowerCase()
                  const candidates = exercises
                    .filter((ex) => ex.name.toLowerCase() !== currentRow.name.trim().toLowerCase())
                    .filter((ex) => !query || ex.name.toLowerCase().includes(query))
                    .sort((a, b) => {
                      const aMatches = currentRow.primaryMuscle && a.primary_muscle === currentRow.primaryMuscle ? 0 : 1
                      const bMatches = currentRow.primaryMuscle && b.primary_muscle === currentRow.primaryMuscle ? 0 : 1
                      return aMatches !== bMatches ? aMatches - bMatches : a.name.localeCompare(b.name)
                    })
                  if (candidates.length === 0) {
                    return <p className="text-sm text-ink-disabled">No matches — type a new name in the exercise field instead.</p>
                  }
                  return (
                    <div className="flex flex-col gap-2">
                      {candidates.map((ex) => (
                        <button
                          key={ex.id}
                          type="button"
                          onClick={() => {
                            setExerciseRows((rows) =>
                              rows.map((r, idx) =>
                                idx === substitutingIndex
                                  ? { ...r, name: ex.name, primaryMuscle: ex.primary_muscle ?? '', secondaryMuscle: ex.secondary_muscle ?? '' }
                                  : r,
                              ),
                            )
                            setSubstitutingIndex(null)
                          }}
                          className="flex items-center justify-between rounded-[20px] border border-line bg-surface px-4 py-3 text-left shadow-card"
                        >
                          <span className="font-medium text-ink">{ex.name}</span>
                          <span className="text-xs text-ink-disabled">{ex.primary_muscle ?? 'Uncategorized'}</span>
                        </button>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {(loggingProgram || editingSession) && (
        <div className="fixed inset-0 z-50 flex flex-col bg-page safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-ink">
              {editingSession ? (editingSession.program_name ?? 'Session') : loggingProgram!.name}
            </h2>
            <button
              onClick={() => {
                setLoggingProgram(null)
                setEditingSession(null)
              }}
              className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2"
            >
              Close ✕
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            <input
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              type="date"
              className="rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink outline-none focus:border-pine"
            />
            {sessionRows.map((row, exIdx) => {
              const catalogEx = exerciseByName.get(row.exerciseName.toLowerCase())
              return (
              <div key={exIdx} className="rounded-[20px] border border-line bg-surface p-3 shadow-card">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-medium text-ink">
                    {row.exerciseName}
                    {catalogEx?.primary_muscle && (
                      <span className="ml-2 text-xs font-normal text-ink-disabled">
                        {catalogEx.primary_muscle}
                        {catalogEx.secondary_muscle ? ` · ${catalogEx.secondary_muscle}` : ''}
                      </span>
                    )}
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSubstitutingSessionIndex(exIdx)
                        setSubstituteSessionQuery('')
                      }}
                      className="pl-2 text-ink-disabled"
                      aria-label="Swap exercise"
                    >
                      ⇄
                    </button>
                    <button
                      type="button"
                      onClick={() => setSessionRows((rows) => rows.filter((_, ri) => ri !== exIdx))}
                      className="pl-2 text-ink-faint"
                      aria-label="Remove exercise from this session"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  {row.sets.map((set, setIdx) => (
                    <div key={setIdx} className="flex items-center gap-2">
                      <span className="w-12 shrink-0 text-xs text-ink-disabled">Set {setIdx + 1}</span>
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
                        className="min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3 py-2 text-ink placeholder-ink-disabled outline-none focus:border-pine"
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
                        className="min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3 py-2 text-ink placeholder-ink-disabled outline-none focus:border-pine"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setSessionRows((rows) =>
                            rows.map((r, ri) => (ri === exIdx ? { ...r, sets: r.sets.filter((_, si) => si !== setIdx) } : r)),
                          )
                        }
                        className="shrink-0 px-1 text-ink-faint"
                        aria-label="Remove set"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setSessionRows((rows) =>
                        rows.map((r, ri) => (ri === exIdx ? { ...r, sets: [...r.sets, { reps: '', weight: '' }] } : r)),
                      )
                    }
                    className="ml-12 self-start text-xs font-semibold text-cat-rose-ink"
                  >
                    + Add set
                  </button>
                </div>
              </div>
              )
            })}
            <button
              type="button"
              onClick={() => {
                setAddExerciseQuery('')
                setAddToProgramToo(false)
                setAddingExercise(true)
              }}
              className="rounded-[20px] border border-line-strong bg-surface py-3 text-sm font-semibold text-pine"
            >
              + Add exercise
            </button>
            <button onClick={saveSession} className="mt-2 rounded-[20px] bg-pine px-4 py-2.5 font-semibold text-white">
              {editingSession ? 'Save changes' : 'Save session'}
            </button>
          </div>

          {substitutingSessionIndex !== null && (
            <div className="fixed inset-0 z-[60] flex flex-col bg-page safe-top safe-bottom">
              <div className="flex items-center justify-between px-4 pt-4">
                <h2 className="text-lg font-bold text-ink">Swap exercise</h2>
                <button
                  onClick={() => setSubstitutingSessionIndex(null)}
                  className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2"
                >
                  Close ✕
                </button>
              </div>
              <div className="p-4">
                <input
                  autoFocus
                  value={substituteSessionQuery}
                  onChange={(e) => setSubstituteSessionQuery(e.target.value)}
                  placeholder="Search exercises"
                  className="w-full rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
                />
              </div>
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                {(() => {
                  const currentRow = sessionRows[substitutingSessionIndex]
                  const currentEx = exerciseByName.get(currentRow.exerciseName.toLowerCase())
                  const query = substituteSessionQuery.trim().toLowerCase()
                  const candidates = exercises
                    .filter((ex) => ex.name.toLowerCase() !== currentRow.exerciseName.trim().toLowerCase())
                    .filter((ex) => !query || ex.name.toLowerCase().includes(query))
                    .sort((a, b) => {
                      const aMatches = currentEx?.primary_muscle && a.primary_muscle === currentEx.primary_muscle ? 0 : 1
                      const bMatches = currentEx?.primary_muscle && b.primary_muscle === currentEx.primary_muscle ? 0 : 1
                      return aMatches !== bMatches ? aMatches - bMatches : a.name.localeCompare(b.name)
                    })
                  if (candidates.length === 0) {
                    return <p className="text-sm text-ink-disabled">No matches.</p>
                  }
                  return (
                    <div className="flex flex-col gap-2">
                      {candidates.map((ex) => (
                        <button
                          key={ex.id}
                          type="button"
                          onClick={() => pickSubstituteForSession(ex.name)}
                          className="flex items-center justify-between rounded-[20px] border border-line bg-surface px-4 py-3 text-left shadow-card"
                        >
                          <span className="font-medium text-ink">{ex.name}</span>
                          <span className="text-xs text-ink-disabled">{ex.primary_muscle ?? 'Uncategorized'}</span>
                        </button>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </div>
          )}

          {addingExercise && (
            <div className="fixed inset-0 z-[60] flex flex-col bg-page safe-top safe-bottom">
              <div className="flex items-center justify-between px-4 pt-4">
                <h2 className="text-lg font-bold text-ink">Add exercise</h2>
                <button
                  onClick={() => setAddingExercise(false)}
                  className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2"
                >
                  Close ✕
                </button>
              </div>
              <div className="p-4">
                <input
                  autoFocus
                  value={addExerciseQuery}
                  onChange={(e) => setAddExerciseQuery(e.target.value)}
                  placeholder="Search exercises or type a new name"
                  className="w-full rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
                />
              </div>
              {sessionProgram() && (
                <div className="flex items-center justify-between px-4 pb-3">
                  <span className="pr-3 text-sm text-ink-2">Also add to {sessionProgram()!.name} for next time</span>
                  <button
                    type="button"
                    onClick={() => setAddToProgramToo((v) => !v)}
                    className={`h-6 w-11 shrink-0 rounded-full transition ${addToProgramToo ? 'bg-pine' : 'bg-line'}`}
                  >
                    <span
                      className={`block h-5 w-5 translate-y-0.5 rounded-full bg-surface transition ${
                        addToProgramToo ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              )}
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                {(() => {
                  const query = addExerciseQuery.trim().toLowerCase()
                  const currentNames = new Set(sessionRows.map((r) => r.exerciseName.toLowerCase()))
                  const candidates = exercises
                    .filter((ex) => !currentNames.has(ex.name.toLowerCase()))
                    .filter((ex) => !query || ex.name.toLowerCase().includes(query))
                    .sort((a, b) => a.name.localeCompare(b.name))
                  const exactMatch = exercises.some((ex) => ex.name.toLowerCase() === query)
                  return (
                    <div className="flex flex-col gap-2">
                      {query && !exactMatch && (
                        <button
                          type="button"
                          onClick={() => addExerciseToSession(addExerciseQuery.trim(), addToProgramToo)}
                          className="rounded-[20px] border border-line-strong bg-surface py-3 text-sm font-semibold text-pine"
                        >
                          + Add "{addExerciseQuery.trim()}" as a new exercise
                        </button>
                      )}
                      {candidates.length === 0 && !query && (
                        <p className="text-sm text-ink-disabled">Type to search, or enter a new exercise name.</p>
                      )}
                      {candidates.map((ex) => (
                        <button
                          key={ex.id}
                          type="button"
                          onClick={() => addExerciseToSession(ex.name, addToProgramToo)}
                          className="flex items-center justify-between rounded-[20px] border border-line bg-surface px-4 py-3 text-left shadow-card"
                        >
                          <span className="font-medium text-ink">{ex.name}</span>
                          <span className="text-xs text-ink-disabled">{ex.primary_muscle ?? 'Uncategorized'}</span>
                        </button>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </div>
          )}
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

      {libraryOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-page safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-ink">Exercise library</h2>
            <button onClick={() => setLibraryOpen(false)} className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2">
              Close ✕
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
            <button
              onClick={openNewExercise}
              className="rounded-[20px] border border-line-strong bg-surface py-3 text-sm font-semibold text-pine"
            >
              + New exercise
            </button>
            {exercises.length === 0 && <p className="text-sm text-ink-disabled">No exercises yet — add one above.</p>}
            {[...MUSCLE_GROUPS, null].map((muscle) => {
              const group = exercises.filter((ex) => (ex.primary_muscle ?? null) === muscle).sort((a, b) => a.name.localeCompare(b.name))
              if (group.length === 0) return null
              return (
                <div key={muscle ?? 'uncategorized'}>
                  <h3 className="mb-1 mt-2 text-xs font-semibold uppercase text-ink-disabled">{muscle ?? 'Uncategorized'}</h3>
                  <div className="flex flex-col gap-2">
                    {group.map((ex) => (
                      <div key={ex.id} className="flex items-center justify-between rounded-[20px] border border-line bg-surface px-4 py-3 shadow-card">
                        <button onClick={() => openEditExercise(ex)} className="flex-1 text-left">
                          <p className="font-medium text-ink">{ex.name}</p>
                          {ex.secondary_muscle && <p className="text-[11px] text-ink-disabled">+ {ex.secondary_muscle}</p>}
                        </button>
                        <button onClick={() => setConfirmDeleteExercise(ex)} className="pl-3 text-ink-faint" aria-label="Remove exercise">
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {exerciseFormOpen && (
            <div className="fixed inset-0 z-[60] flex flex-col bg-page safe-top safe-bottom">
              <div className="flex items-center justify-between px-4 pt-4">
                <h2 className="text-lg font-bold text-ink">{editingExercise ? 'Edit exercise' : 'New exercise'}</h2>
                <button
                  onClick={() => setExerciseFormOpen(false)}
                  className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2"
                >
                  Close ✕
                </button>
              </div>
              <form onSubmit={saveExerciseForm} className="flex flex-1 flex-col gap-2 p-4">
                <input
                  autoFocus
                  value={exerciseFormName}
                  onChange={(e) => setExerciseFormName(e.target.value)}
                  placeholder="Exercise name, e.g. Hack Squat"
                  className="rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
                />
                <select
                  value={exerciseFormPrimary}
                  onChange={(e) => setExerciseFormPrimary(e.target.value)}
                  className="rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink outline-none focus:border-pine"
                >
                  <option value="">Primary muscle</option>
                  {MUSCLE_GROUPS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  value={exerciseFormSecondary}
                  onChange={(e) => setExerciseFormSecondary(e.target.value)}
                  className="rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink outline-none focus:border-pine"
                >
                  <option value="">Secondary muscle (optional)</option>
                  {MUSCLE_GROUPS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <button type="submit" className="mt-2 rounded-[20px] bg-pine px-4 py-2.5 font-semibold text-white">
                  {editingExercise ? 'Save changes' : 'Add exercise'}
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteExercise !== null}
        title={`Remove "${confirmDeleteExercise?.name ?? ''}" from your exercise library?`}
        message="Programs using this exercise keep their name — they just won't be grouped under this catalog entry for swap suggestions anymore."
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirmDeleteExercise) deleteExercise(confirmDeleteExercise)
          setConfirmDeleteExercise(null)
        }}
        onCancel={() => setConfirmDeleteExercise(null)}
      />
    </div>
  )
}
