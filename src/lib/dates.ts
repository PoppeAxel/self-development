import { format, startOfWeek } from 'date-fns'

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function weekStartISO(reference: Date = new Date()): string {
  return format(startOfWeek(reference, { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

// Reminders are stored in UTC (time_of_day) so the edge function's UTC clock
// comparison lines up regardless of the device's timezone.
export function localTimeToUTC(local: string): string {
  const [h, m] = local.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

export function utcTimeToLocal(utc: string): string {
  const [h, m] = utc.split(':').map(Number)
  const d = new Date()
  d.setUTCHours(h, m, 0, 0)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
