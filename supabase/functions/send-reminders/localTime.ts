// Pure time logic for send-reminders, kept apart so scripts/reminders.check.ts can run it
// under Node. Reminders store wall-clock time + days in their own timezone (0036).

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The local date (yyyy-MM-dd), weekday (0 = Sun) and minute-of-day of `now` in `timeZone`. */
export function localParts(now: Date, timeZone: string): { date: string; day: number; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    day: WEEKDAYS.indexOf(parts.weekday),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

/**
 * Due if its time fell in the 15 minutes up to now (cron runs every 15) on one of its
 * days. Half-open, so a reminder exactly on a quarter-hour fires on one run, not two. A
 * 23:55 reminder fires on the 00:00 run, so it's checked against yesterday's weekday.
 */
export function isDue(timeOfDay: string, days: number[], now: { day: number; minutes: number }): boolean {
  const [h, m] = timeOfDay.split(':').map(Number)
  const at = h * 60 + m
  if ((now.minutes - at + 1440) % 1440 >= 15) return false
  return days.includes(at > now.minutes ? (now.day + 6) % 7 : now.day)
}
