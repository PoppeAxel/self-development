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

// Strava sport_types seen so far, styled for the Cardio breakdown chart. Unknown types
// (a new sport Strava starts sending) fall back to a generic style below rather than
// erroring — extend this map when a new one shows up worth distinguishing.
const SPORT_STYLES: Record<string, SportStyle> = {
  Run: { label: 'Run', icon: '👟', color: '#f97316' },
  TrailRun: { label: 'Trail run', icon: '👟', color: '#ea580c' },
  Ride: { label: 'Ride', icon: '🚴', color: '#0ea5e9' },
  VirtualRide: { label: 'Ride', icon: '🚴', color: '#0ea5e9' },
  MountainBikeRide: { label: 'MTB ride', icon: '🚵', color: '#0284c7' },
  GravelRide: { label: 'Gravel ride', icon: '🚴', color: '#0369a1' },
  Swim: { label: 'Swim', icon: '🏊', color: '#06b6d4' },
  Walk: { label: 'Walk', icon: '🚶', color: '#a3a3a3' },
  Hike: { label: 'Hike', icon: '🥾', color: '#84cc16' },
  Soccer: { label: 'Football', icon: '⚽', color: '#22c55e' },
  AlpineSki: { label: 'Ski', icon: '⛷️', color: '#818cf8' },
  Snowboard: { label: 'Snowboard', icon: '🏂', color: '#818cf8' },
  Rowing: { label: 'Rowing', icon: '🚣', color: '#a855f7' },
}

const DEFAULT_SPORT_STYLE: SportStyle = { label: '', icon: '🏅', color: '#94a3b8' }

export function getSportStyle(sportType: string): SportStyle {
  return SPORT_STYLES[sportType] ?? { ...DEFAULT_SPORT_STYLE, label: sportType }
}
