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
