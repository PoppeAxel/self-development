import {
  addDays,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  format,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from 'date-fns'
import type { PeriodType } from './types'

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const PERIOD_TYPES: PeriodType[] = ['week', 'month', 'quarter', 'year']
export const PERIOD_LABELS: Record<PeriodType, string> = { week: 'Weekly', month: 'Monthly', quarter: 'Quarterly', year: 'Yearly' }
// The next-longer period a goal can nest under, e.g. a weekly goal's parent is a monthly one.
export const PARENT_PERIOD: Record<PeriodType, PeriodType | null> = { week: 'month', month: 'quarter', quarter: 'year', year: null }

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function weekStartISO(reference: Date = new Date()): string {
  return format(startOfWeek(reference, { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

export function monthStartISO(reference: Date = new Date()): string {
  return format(startOfMonth(reference), 'yyyy-MM-dd')
}

export function quarterStartISO(reference: Date = new Date()): string {
  return format(startOfQuarter(reference), 'yyyy-MM-dd')
}

export function yearStartISO(reference: Date = new Date()): string {
  return format(startOfYear(reference), 'yyyy-MM-dd')
}

export function periodStartISO(periodType: PeriodType, reference: Date = new Date()): string {
  if (periodType === 'week') return weekStartISO(reference)
  if (periodType === 'month') return monthStartISO(reference)
  if (periodType === 'quarter') return quarterStartISO(reference)
  return yearStartISO(reference)
}

// Last day of the period beginning on periodStart, e.g. Sunday for a Mon-start week,
// Dec 31 for a year — used to bound a metric sum/count or a child-goal rollup query.
export function periodEndISO(periodType: PeriodType, periodStart: string): string {
  const start = new Date(periodStart + 'T00:00:00')
  if (periodType === 'week') return format(addDays(start, 6), 'yyyy-MM-dd')
  if (periodType === 'month') return format(endOfMonth(start), 'yyyy-MM-dd')
  if (periodType === 'quarter') return format(endOfQuarter(start), 'yyyy-MM-dd')
  return format(endOfYear(start), 'yyyy-MM-dd')
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
