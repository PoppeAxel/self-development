import { getOptionRows } from './optionStore'
// Mirrors STRENGTH_SPORT_TYPES in supabase/functions/sync-strava-workouts/index.ts —
// keep these two lists in sync. Everything else (Run, Ride, Swim, Walk, Hike, Soccer, ...)
// counts as cardio.
const STRENGTH_SPORT_TYPES = new Set(['WeightTraining', 'Crossfit', 'Workout', 'HighIntensityIntervalTraining'])

export function isStrengthWorkout(sportType: string): boolean {
  return STRENGTH_SPORT_TYPES.has(sportType)
}

export function formatWorkoutDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function formatWorkoutDistance(meters: number | null): string | null {
  if (meters == null || meters === 0) return null
  return `${(meters / 1000).toFixed(1)} km`
}

export interface SportStyle {
  label: string
  icon: string
  color: string
}

// Strava sport_types, styled for the Cardio chart and list: `options` rows of kind 'sport_style'
// (migration 0051, edited in place on Training → Cardio), matched on meta.sport_type. A type Strava
// sends that has no row yet gets the neutral style below, labelled with its own name.
const DEFAULT_SPORT_STYLE: SportStyle = { label: '', icon: '🏅', color: '#a09a8c' }

/** The sport_style row for a Strava sport_type (live first, else archived). */
export const sportRow = (sportType: string) => {
  const rows = getOptionRows().filter((r) => r.kind === 'sport_style' && (r.meta.sport_type ?? r.key) === sportType)
  return rows.find((r) => !r.archived_at) ?? rows[0]
}

export function getSportStyle(sportType: string): SportStyle {
  const r = sportRow(sportType)
  return r ? { label: r.label, icon: r.icon ?? DEFAULT_SPORT_STYLE.icon, color: r.color ?? DEFAULT_SPORT_STYLE.color } : { ...DEFAULT_SPORT_STYLE, label: sportType }
}
