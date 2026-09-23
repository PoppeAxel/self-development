import { addDays, format, parseISO } from 'date-fns'
import { estimatedOneRepMax, type LiftPoint, type MuscleGroup } from './exercises'
import { isStrengthWorkout } from './workouts'
import type { GoalPace } from './goals'
import type { Exercise, GymProgram, GymSession, GymSessionSet, Workout } from './types'

// The Training tab (Journal) and live workout mode read everything through here, so the
// page and the finish screen can't disagree about a number.

// Push/Pull lumped chest in with shoulders, which hid exactly the gap a target band is
// there to show — so balance is measured per region instead. MUSCLE_REGIONS is unrelated.
export const BALANCE_REGIONS: Record<string, MuscleGroup[]> = {
  Back: ['Upper back', 'Lower back'],
  Chest: ['Chest'],
  Shoulders: ['Shoulders'],
  Arms: ['Biceps', 'Triceps', 'Forearms'],
  Legs: ['Quads', 'Hamstrings', 'Glutes', 'Calves'],
  Core: ['Core', 'Full body'],
}
export const SET_TARGET = { min: 10, max: 20 } as const

const REGION_OF = new Map<string, string>(
  Object.entries(BALANCE_REGIONS).flatMap(([region, muscles]) => muscles.map((m) => [m, region] as [string, string])),
)

export type BalanceStatus = 'under' | 'in' | 'over'
export interface RegionBalance {
  region: string
  perWeek: number
  status: BalanceStatus
}

function shiftDate(date: string, days: number): string {
  return format(addDays(parseISO(date), days), 'yyyy-MM-dd')
}

/** Sets per week to one decimal, trailing ".0" dropped: 16.5, 14, 3. */
export function formatSets(n: number): string {
  return String(Math.round(n * 10) / 10)
}

/**
 * 4-week average sets/week per region. A set counts 1 toward its exercise's primary
 * region and 0.5 toward the secondary one — but only when that's a *different* region
 * (bench: Chest 1, Arms 0.5, never Chest 1.5). Weeks with no gym visit still count in
 * the average: skipping the gym is real data here, unlike a half-logged food day.
 */
export function regionBalance(
  sessions: GymSession[],
  sets: GymSessionSet[],
  exercisesByName: Map<string, Exercise>,
  today: string,
  weeks = 4,
): RegionBalance[] {
  const from = shiftDate(today, -(weeks * 7 - 1))
  const inWindow = new Set(sessions.filter((s) => s.date >= from && s.date <= today).map((s) => s.id))
  const totals = new Map<string, number>()
  const add = (region: string, n: number) => totals.set(region, (totals.get(region) ?? 0) + n)
  for (const set of sets) {
    if (!inWindow.has(set.session_id)) continue
    const ex = exercisesByName.get(set.exercise_name.toLowerCase())
    const primary = ex?.primary_muscle ? REGION_OF.get(ex.primary_muscle) : undefined
    const secondary = ex?.secondary_muscle ? REGION_OF.get(ex.secondary_muscle) : undefined
    if (primary) add(primary, 1)
    if (secondary && secondary !== primary) add(secondary, 0.5)
  }
  return Object.keys(BALANCE_REGIONS).map((region) => {
    // Rounded here so the shown number and its "N under" always add up to the target.
    const perWeek = Math.round(((totals.get(region) ?? 0) / weeks) * 10) / 10
    const status: BalanceStatus = perWeek < SET_TARGET.min ? 'under' : perWeek > SET_TARGET.max ? 'over' : 'in'
    return { region, perWeek, status }
  })
}

export interface StripDay {
  date: string
  strengthSets: number | null
  cardioKm: number | null
  isToday: boolean
  isFuture: boolean
}

/** Mon–Sun cells for the week strip. Null means nothing that day, not zero. */
export function weekStrip(
  weekStart: string,
  sessions: GymSession[],
  sets: GymSessionSet[],
  workouts: Workout[],
  today: string,
): StripDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = shiftDate(weekStart, i)
    const ids = new Set(sessions.filter((s) => s.date === date).map((s) => s.id))
    const cardio = workouts.filter((w) => w.date === date && !isStrengthWorkout(w.sport_type))
    return {
      date,
      strengthSets: ids.size ? sets.filter((s) => ids.has(s.session_id)).length : null,
      cardioKm: cardio.length ? cardio.reduce((sum, w) => sum + (w.distance_meters ?? 0), 0) / 1000 : null,
      isToday: date === today,
      isFuture: date > today,
    }
  })
}

export interface PaceTrend {
  /** Seconds per km for 'min/km', km/h for 'km/h'. */
  current: number
  deltaVs8wAgo: number | null
  unit: 'min/km' | 'km/h'
}

/**
 * Per-sport pace over the window: `current` is the average of the last 4 workouts, the
 * delta compares it with the first 4. Null under 3 workouts; the delta alone is null under
 * 5, where the first and last four would be mostly the same workouts.
 */
export function paceTrend(workouts: Workout[], sport: string, today: string, weeks = 8): PaceTrend | null {
  const from = shiftDate(today, -(weeks * 7 - 1))
  const list = workouts
    .filter((w) => w.sport_type === sport && w.date >= from && w.date <= today && (w.distance_meters ?? 0) > 0 && w.duration_seconds > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (list.length < 3) return null
  const unit = sport.includes('Ride') ? 'km/h' : 'min/km'
  const pace = (w: Workout) => {
    const km = (w.distance_meters as number) / 1000
    return unit === 'km/h' ? km / (w.duration_seconds / 3600) : w.duration_seconds / km
  }
  const avg = (ws: Workout[]) => ws.reduce((sum, w) => sum + pace(w), 0) / ws.length
  const current = avg(list.slice(-4))
  return { current, deltaVs8wAgo: list.length >= 5 ? current - avg(list.slice(0, 4)) : null, unit }
}

export function formatPace(trend: PaceTrend): string {
  if (trend.unit === 'km/h') return `${trend.current.toFixed(1)} km/h`
  const s = Math.round(trend.current)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /km`
}

/** "↗ 9 s faster" / "→ steady" / "↘ 0.4 km/h slower". Runs: lower is better. */
export function paceTrendLabel(trend: PaceTrend): { text: string; tone: 'good' | 'bad' | 'flat' } | null {
  const d = trend.deltaVs8wAgo
  if (d == null) return null
  const faster = trend.unit === 'km/h' ? d : -d
  const size = Math.abs(d)
  if (trend.unit === 'km/h' ? size < 0.3 : size < 5) return { text: '→ steady', tone: 'flat' }
  const amount = trend.unit === 'km/h' ? `${size.toFixed(1)} km/h` : `${Math.round(size)} s`
  return faster > 0 ? { text: `↗ ${amount} faster`, tone: 'good' } : { text: `↘ ${amount} slower`, tone: 'bad' }
}

/** Best e1RM per session for one lift, ascending by date. */
export function liftPoints(exerciseName: string, sessions: GymSession[], sets: GymSessionSet[]): LiftPoint[] {
  const target = exerciseName.toLowerCase()
  const dateOf = new Map(sessions.map((s) => [s.id, s.date]))
  const best = new Map<string, number>()
  for (const s of sets) {
    if (s.exercise_name.toLowerCase() !== target || s.weight == null || s.reps == null) continue
    const e = estimatedOneRepMax(Number(s.weight), s.reps)
    best.set(s.session_id, Math.max(best.get(s.session_id) ?? 0, e))
  }
  return [...best.entries()]
    .filter(([id]) => dateOf.has(id))
    .map(([id, e1rm]) => ({ date: dateOf.get(id)!, e1rm: Math.round(e1rm * 10) / 10 }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Best e1RM among some sets, or null when none has both weight and reps. */
export function bestE1rm(sets: { reps: number | null; weight: number | null }[]): number | null {
  const values = sets.filter((s) => s.weight != null && s.reps != null).map((s) => estimatedOneRepMax(Number(s.weight), s.reps as number))
  return values.length ? Math.max(...values) : null
}

/**
 * The most recent session containing this exercise, and its sets in order. `sessions`
 * must be newest-first.
 */
export function lastTime(
  exerciseName: string,
  sessions: GymSession[],
  setsBySession: Map<string, GymSessionSet[]>,
  excludeSessionId?: string | null,
): { date: string; sets: GymSessionSet[] } | null {
  const target = exerciseName.toLowerCase()
  for (const session of sessions) {
    if (session.id === excludeSessionId) continue
    const sets = (setsBySession.get(session.id) ?? []).filter((s) => s.exercise_name.toLowerCase() === target)
    if (sets.length) return { date: session.date, sets: sets.slice().sort((a, b) => a.set_number - b.set_number) }
  }
  return null
}

/** The program after the most recently logged one, in created_at order, wrapping round. */
export function nextProgram(programs: GymProgram[], sessionsNewestFirst: GymSession[]): GymProgram | null {
  const last = sessionsNewestFirst.find((s) => s.program_id && programs.some((p) => p.id === s.program_id))
  if (!last) return programs[0] ?? null
  const i = programs.findIndex((p) => p.id === last.program_id)
  return programs[(i + 1) % programs.length]
}

/**
 * Sessions that can be linked to a Strava workout without asking: exactly one unlinked
 * strength workout on the session's date, and no other unlinked session that day to
 * compete for it. Anything ambiguous is left to the picker in History.
 */
export function autoLinks(sessions: GymSession[], workouts: Workout[]): { sessionId: string; workoutId: string }[] {
  const linked = new Set(sessions.map((s) => s.strava_workout_id).filter(Boolean))
  const free = workouts.filter((w) => isStrengthWorkout(w.sport_type) && !linked.has(w.id))
  const unlinked = sessions.filter((s) => !s.strava_workout_id)
  return unlinked.flatMap((s) => {
    const sameDay = free.filter((w) => w.date === s.date)
    const rivals = unlinked.filter((o) => o.date === s.date)
    return sameDay.length === 1 && rivals.length === 1 ? [{ sessionId: s.id, workoutId: sameDay[0].id }] : []
  })
}

/**
 * The hero caption under a plan-vs-actual bar, built from goalPace() so it says the same
 * thing the Goals screen does. The "closes it" hint only appears for distance when the
 * remainder fits in one run you've actually done lately (`longestKm`).
 */
export function planCaption(pace: GoalPace, target: number, actual: number, unit: 'sessions' | 'km', longestKm: number | null): string {
  const remaining = target - actual
  if (remaining <= 0) return 'Done for the week'
  const more = unit === 'km' ? `${remaining.toFixed(1)} km more` : `${remaining === 1 ? 'one' : remaining} more`
  const tail = pace.daysLeft === 0 ? 'today' : 'by Sunday'
  // Sessions come in whole numbers, so "0.4 sessions behind" rounds to on pace.
  const behind = unit === 'km' ? -(pace.delta ?? 0) : Math.round(-(pace.delta ?? 0))
  if (pace.onPace || behind <= 0) {
    return `${!pace.onPace && (pace.delta ?? 0) > 0 ? 'Ahead of pace' : 'On pace'} · ${more} ${tail}`
  }
  const gap = unit === 'km' ? `${behind.toFixed(1)} km` : `${behind} session${behind === 1 ? '' : 's'}`
  const hint = unit === 'km' && longestKm != null && remaining <= longestKm ? ` · a ${Math.ceil(remaining)} km run closes it` : ''
  return `${gap} behind pace${hint}`
}
