import { useImperativeHandle, useState, type Ref } from 'react'
import { supabase } from '../lib/supabase'
import { MUSCLE_GROUPS } from '../lib/exercises'
import { lastTime } from '../lib/training'
import { ConfirmDialog } from './ConfirmDialog'
import type { Exercise, GymProgram, GymProgramExercise, GymSession, GymSessionSet } from '../lib/types'

// Program CRUD, the program builder, the exercise library and the edit-a-past-session
// sheet. Everything it shows is owned by the Training tab (src/components/Training.tsx),
// which opens these sheets through the ref and reloads on `onChanged`. Lift progress,
// muscle balance and recent sessions used to live here too; they moved to Training.

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

export interface GymProgramsHandle {
  newProgram: () => void
  editPrograms: () => void
  editSession: (session: GymSession) => void
}

function emptyExerciseRow(): ExerciseRow {
  return { name: '', sets: '3', reps: '10', primaryMuscle: '', secondaryMuscle: '' }
}

const SHEET = 'fixed inset-0 flex flex-col bg-page safe-top safe-bottom'
const CLOSE_BTN = 'rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2'
const INPUT =
  'rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine'

/**
 * Pick a replacement exercise from the library, same-muscle ones first. Shared by the
 * program builder, the past-session editor and live workout mode. `z` is the layer it
 * sits on — always one above whatever sheet opened it.
 */
export function SwapSheet({
  exercises,
  currentName,
  primaryMuscle,
  onPick,
  onClose,
  z = 'z-[60]',
}: {
  exercises: Exercise[]
  currentName: string
  primaryMuscle: string | null | undefined
  onPick: (ex: Exercise) => void
  onClose: () => void
  z?: string
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const candidates = exercises
    .filter((ex) => ex.name.toLowerCase() !== currentName.trim().toLowerCase())
    .filter((ex) => !q || ex.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const aMatches = primaryMuscle && a.primary_muscle === primaryMuscle ? 0 : 1
      const bMatches = primaryMuscle && b.primary_muscle === primaryMuscle ? 0 : 1
      return aMatches !== bMatches ? aMatches - bMatches : a.name.localeCompare(b.name)
    })
  return (
    <div className={`${SHEET} ${z}`}>
      <div className="flex items-center justify-between px-4 pt-4">
        <h2 className="text-lg font-bold text-ink">Swap exercise</h2>
        <button onClick={onClose} className={CLOSE_BTN}>
          Close ✕
        </button>
      </div>
      <div className="p-4">
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search exercises" className={`w-full ${INPUT}`} />
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 pb-4">
        {candidates.length === 0 && <p className="text-sm text-ink-disabled">No matches.</p>}
        {candidates.map((ex) => (
          <button
            key={ex.id}
            type="button"
            onClick={() => onPick(ex)}
            className="flex items-center justify-between rounded-[20px] border border-line bg-surface px-4 py-3 text-left shadow-card"
          >
            <span className="font-medium text-ink">{ex.name}</span>
            <span className="text-xs text-ink-disabled">{ex.primary_muscle ?? 'Uncategorized'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function GymPrograms({
  ref,
  programs,
  exercisesByProgram,
  exercises,
  sessions,
  setsBySession,
  onChanged,
}: {
  ref: Ref<GymProgramsHandle>
  programs: GymProgram[]
  exercisesByProgram: Map<string, GymProgramExercise[]>
  exercises: Exercise[]
  /** Newest first. */
  sessions: GymSession[]
  setsBySession: Map<string, GymSessionSet[]>
  onChanged: () => void
}) {
  const [confirmDeleteProgram, setConfirmDeleteProgram] = useState<GymProgram | null>(null)
  const [programsListOpen, setProgramsListOpen] = useState(false)

  const [builderOpen, setBuilderOpen] = useState(false)
  const [editingProgram, setEditingProgram] = useState<GymProgram | null>(null)
  const [programName, setProgramName] = useState('')
  const [exerciseRows, setExerciseRows] = useState<ExerciseRow[]>([emptyExerciseRow()])
  const [substitutingIndex, setSubstitutingIndex] = useState<number | null>(null)

  const [editingSession, setEditingSession] = useState<GymSession | null>(null)
  const [sessionDate, setSessionDate] = useState('')
  const [sessionRows, setSessionRows] = useState<SessionExerciseRow[]>([])
  const [substitutingSessionIndex, setSubstitutingSessionIndex] = useState<number | null>(null)
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

  const exerciseByName = new Map(exercises.map((ex) => [ex.name.toLowerCase(), ex]))

  useImperativeHandle(ref, () => ({ newProgram: openBuilder, editPrograms: () => setProgramsListOpen(true), editSession: openEditSession }))

  function openBuilder() {
    setEditingProgram(null)
    setProgramName('')
    setExerciseRows([emptyExerciseRow()])
    setBuilderOpen(true)
  }

  function openEditProgram(program: GymProgram) {
    const progExercises = (exercisesByProgram.get(program.id) ?? []).slice().sort((a, b) => a.position - b.position)
    const exerciseById = new Map(exercises.map((ex) => [ex.id, ex]))
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
    onChanged()
  }

  async function deleteProgram(program: GymProgram) {
    await supabase.from('gym_programs').delete().eq('id', program.id)
    onChanged()
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
    onChanged()
  }

  async function deleteExercise(ex: Exercise) {
    await supabase.from('exercises').delete().eq('id', ex.id)
    onChanged()
  }

  // Past sessions are edited here; new ones are logged in live workout mode instead.
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
    setEditingSession(session)
  }

  // Replaces a session row's exercise in place (e.g. equipment unavailable, an injury) —
  // this only affects the session being edited, not the underlying program. To log an
  // extra exercise without losing the original, use "+ Add exercise" instead of swapping.
  function pickSubstituteForSession(newExerciseName: string) {
    if (substitutingSessionIndex == null) return
    const previous = lastTime(newExerciseName, sessions, setsBySession, editingSession?.id)?.sets
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

  // The program the edited session belongs to, if it still exists — used to offer "also
  // add to the program" when adding an ad-hoc exercise.
  const sessionProgram = editingSession?.program_id ? (programs.find((p) => p.id === editingSession.program_id) ?? null) : null

  // Adds an exercise to just this session (3 blank sets, same starting point as a new
  // program row) without touching anything else already logged. Optionally also persists
  // it onto the underlying program's exercise list so it shows up automatically next time.
  async function addExerciseToSession(name: string, alsoAddToProgram: boolean) {
    setSessionRows((rows) => [...rows, { exerciseName: name, sets: Array.from({ length: 3 }, () => ({ reps: '', weight: '' })) }])
    setAddingExercise(false)

    const program = alsoAddToProgram ? sessionProgram : null
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
    onChanged()
  }

  async function saveSession() {
    if (!editingSession) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const sessionId = editingSession.id

    await supabase.from('gym_sessions').update({ date: sessionDate }).eq('id', sessionId)
    await supabase.from('gym_session_sets').delete().eq('session_id', sessionId)

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

    setEditingSession(null)
    onChanged()
  }

  const libraryButton = (
    <button type="button" onClick={() => setLibraryOpen(true)} className="text-sm font-medium text-ink-3">
      📋 Exercise library ({exercises.length})
    </button>
  )

  return (
    <>
      {programsListOpen && (
        <div className={`${SHEET} z-50`}>
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-ink">Programs</h2>
            <button onClick={() => setProgramsListOpen(false)} className={CLOSE_BTN}>
              Close ✕
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
            {programs.map((program) => {
              const count = (exercisesByProgram.get(program.id) ?? []).length
              return (
                <div key={program.id} className="flex items-center justify-between rounded-[20px] border border-line bg-surface px-4 py-3 shadow-card">
                  <button onClick={() => openEditProgram(program)} className="flex-1 text-left">
                    <p className="font-medium text-ink">{program.name}</p>
                    <p className="text-[11px] text-ink-disabled">
                      {count} exercise{count === 1 ? '' : 's'}
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
            <button onClick={openBuilder} className="rounded-[20px] border border-line-strong bg-surface py-3 text-sm font-semibold text-pine">
              + New program
            </button>
            {libraryButton}
          </div>
        </div>
      )}

      {builderOpen && (
        <div className={`${SHEET} z-[55]`}>
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-ink">{editingProgram ? 'Edit program' : 'New program'}</h2>
            <button
              onClick={() => {
                setBuilderOpen(false)
                setEditingProgram(null)
              }}
              className={CLOSE_BTN}
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
              className={INPUT}
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
                      className={`min-w-0 flex-1 ${INPUT}`}
                    />
                    <button
                      type="button"
                      onClick={() => setSubstitutingIndex(i)}
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
            {libraryButton}
          </form>

          {substitutingIndex !== null && (
            <SwapSheet
              exercises={exercises}
              currentName={exerciseRows[substitutingIndex].name}
              primaryMuscle={exerciseRows[substitutingIndex].primaryMuscle}
              onClose={() => setSubstitutingIndex(null)}
              onPick={(ex) => {
                setExerciseRows((rows) =>
                  rows.map((r, idx) =>
                    idx === substitutingIndex
                      ? { ...r, name: ex.name, primaryMuscle: ex.primary_muscle ?? '', secondaryMuscle: ex.secondary_muscle ?? '' }
                      : r,
                  ),
                )
                setSubstitutingIndex(null)
              }}
            />
          )}
        </div>
      )}

      {editingSession && (
        <div className={`${SHEET} z-50`}>
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-ink">{editingSession.program_name ?? 'Session'}</h2>
            <button onClick={() => setEditingSession(null)} className={CLOSE_BTN}>
              Close ✕
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            <input value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} type="date" className={INPUT} />
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
                        onClick={() => setSubstitutingSessionIndex(exIdx)}
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
              Save changes
            </button>
          </div>

          {substitutingSessionIndex !== null && (
            <SwapSheet
              exercises={exercises}
              currentName={sessionRows[substitutingSessionIndex].exerciseName}
              primaryMuscle={exerciseByName.get(sessionRows[substitutingSessionIndex].exerciseName.toLowerCase())?.primary_muscle}
              onClose={() => setSubstitutingSessionIndex(null)}
              onPick={(ex) => pickSubstituteForSession(ex.name)}
            />
          )}

          {addingExercise && (
            <div className={`${SHEET} z-[60]`}>
              <div className="flex items-center justify-between px-4 pt-4">
                <h2 className="text-lg font-bold text-ink">Add exercise</h2>
                <button onClick={() => setAddingExercise(false)} className={CLOSE_BTN}>
                  Close ✕
                </button>
              </div>
              <div className="p-4">
                <input
                  autoFocus
                  value={addExerciseQuery}
                  onChange={(e) => setAddExerciseQuery(e.target.value)}
                  placeholder="Search exercises or type a new name"
                  className={`w-full ${INPUT}`}
                />
              </div>
              {sessionProgram && (
                <div className="flex items-center justify-between px-4 pb-3">
                  <span className="pr-3 text-sm text-ink-2">Also add to {sessionProgram.name} for next time</span>
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

      {libraryOpen && (
        <div className={`${SHEET} z-[60]`}>
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-ink">Exercise library</h2>
            <button onClick={() => setLibraryOpen(false)} className={CLOSE_BTN}>
              Close ✕
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
            <button onClick={openNewExercise} className="rounded-[20px] border border-line-strong bg-surface py-3 text-sm font-semibold text-pine">
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
            <div className={`${SHEET} z-[65]`}>
              <div className="flex items-center justify-between px-4 pt-4">
                <h2 className="text-lg font-bold text-ink">{editingExercise ? 'Edit exercise' : 'New exercise'}</h2>
                <button onClick={() => setExerciseFormOpen(false)} className={CLOSE_BTN}>
                  Close ✕
                </button>
              </div>
              <form onSubmit={saveExerciseForm} className="flex flex-1 flex-col gap-2 p-4">
                <input
                  autoFocus
                  value={exerciseFormName}
                  onChange={(e) => setExerciseFormName(e.target.value)}
                  placeholder="Exercise name, e.g. Hack Squat"
                  className={INPUT}
                />
                <select value={exerciseFormPrimary} onChange={(e) => setExerciseFormPrimary(e.target.value)} className={INPUT}>
                  <option value="">Primary muscle</option>
                  {MUSCLE_GROUPS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <select value={exerciseFormSecondary} onChange={(e) => setExerciseFormSecondary(e.target.value)} className={INPUT}>
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
    </>
  )
}
