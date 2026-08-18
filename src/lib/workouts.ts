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
