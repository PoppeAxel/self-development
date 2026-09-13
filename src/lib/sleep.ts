export const RECOMMENDED_SLEEP_HOURS = 8

export function formatSleepDuration(hoursDecimal: number): string {
  const totalMinutes = Math.round(hoursDecimal * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  // Drop the "0h" for sub-hour durations — same convention as formatWorkoutDuration.
  // Week-over-week sleep deltas are almost always under an hour, where "0h 55m" reads badly.
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
