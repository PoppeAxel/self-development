import { addDays, format, getDay } from 'date-fns'
import type { DailyTask } from './types'

// The Today page as a planner: recurring tasks ("habits") can repeat on chosen weekdays,
// and one-time tasks ("to-dos") sit on a date and carry over until done. Everything here is
// a pure function of tasks + completion dates, so the page, and scripts/planner.check.ts,
// read the same rules.

/** Display order for weekday pickers: Monday first. Values are getDay()'s 0 = Sunday. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Schedulable = Pick<DailyTask, 'recurring' | 'scheduled_date' | 'repeat_days'>

const weekday = (date: string) => getDay(new Date(date + 'T00:00:00'))

/**
 * Does a task belong on `date`? Nothing shows before its scheduled date. A recurring task
 * then shows on its repeat days (no list = every day); a one-time task shows every day
 * from its date until it's done — the carry-over is what makes it "late".
 */
export function isScheduledOn(task: Schedulable, date: string): boolean {
  if (task.scheduled_date && task.scheduled_date > date) return false
  if (!task.recurring || !task.repeat_days?.length) return true
  return task.repeat_days.includes(weekday(date))
}

/** "Every day", "Weekdays", "Weekends", or the days themselves: "Mon · Wed · Fri". */
export function repeatLabel(days: number[] | null | undefined): string {
  const set = new Set(days ?? [])
  if (set.size === 0 || set.size === 7) return 'Every day'
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return 'Weekdays'
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends'
  return WEEK_ORDER.filter((d) => set.has(d))
    .map((d) => SHORT[d])
    .join(' · ')
}

/**
 * The last `n` days a recurring task was due, up to `date`, oldest first — true where it
 * was done. Today only counts once it's done, so a habit you haven't got to yet doesn't
 * read as a miss. Stops at the task's start, so a new habit shows fewer dots, not misses.
 */
export function habitHistory(
  task: Schedulable & Pick<DailyTask, 'created_at'>,
  doneDates: Set<string>,
  date: string,
  n = 7,
): boolean[] {
  const start = task.scheduled_date ?? task.created_at.slice(0, 10)
  const out: boolean[] = []
  let cursor = doneDates.has(date) ? date : format(addDays(new Date(date + 'T00:00:00'), -1), 'yyyy-MM-dd')
  // Bounded walk: even a once-a-week habit fills seven dots within ~7 weeks.
  for (let i = 0; i < 70 && out.length < n && cursor >= start; i++) {
    if (isScheduledOn(task, cursor)) out.push(doneDates.has(cursor))
    cursor = format(addDays(new Date(cursor + 'T00:00:00'), -1), 'yyyy-MM-dd')
  }
  return out.reverse()
}
