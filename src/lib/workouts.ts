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
  Run: { label: 'Run', icon: '👟', color: '#a8563f' },
  TrailRun: { label: 'Trail run', icon: '👟', color: '#8a4630' },
  Ride: { label: 'Ride', icon: '🚴', color: '#46608f' },
  VirtualRide: { label: 'Ride', icon: '🚴', color: '#46608f' },
  MountainBikeRide: { label: 'MTB ride', icon: '🚵', color: '#35528f' },
  GravelRide: { label: 'Gravel ride', icon: '🚴', color: '#2c4372' },
  Swim: { label: 'Swim', icon: '🏊', color: '#3f7f8a' },
  Walk: { label: 'Walk', icon: '🚶', color: '#8b8577' },
  Hike: { label: 'Hike', icon: '🥾', color: '#6f8a3f' },
  Soccer: { label: 'Football', icon: '⚽', color: '#2f6b5a' },
  AlpineSki: { label: 'Ski', icon: '⛷️', color: '#6a4f7a' },
  Snowboard: { label: 'Snowboard', icon: '🏂', color: '#5d4470' },
  Rowing: { label: 'Rowing', icon: '🚣', color: '#7a5a8a' },
}

const DEFAULT_SPORT_STYLE: SportStyle = { label: '', icon: '🏅', color: '#a09a8c' }

export function getSportStyle(sportType: string): SportStyle {
  return SPORT_STYLES[sportType] ?? { ...DEFAULT_SPORT_STYLE, label: sportType }
}
