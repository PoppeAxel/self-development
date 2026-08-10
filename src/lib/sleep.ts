export const RECOMMENDED_SLEEP_HOURS = 8

export function formatSleepDuration(hoursDecimal: number): string {
  const totalMinutes = Math.round(hoursDecimal * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h}h ${m}m`
}
