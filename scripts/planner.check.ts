// Asserts the pure planner helpers in src/lib/planner.ts. Run:
//   npx rolldown scripts/planner.check.ts --platform node -f esm -o <tmp>/pc.mjs && node <tmp>/pc.mjs
import assert from 'node:assert/strict'
import { habitHistory, isScheduledOn, levelFor, repeatLabel } from '../src/lib/planner'

// Scheduling. 2026-10-21 is a Wednesday (getDay 3).
const daily = { recurring: true, scheduled_date: null, repeat_days: null }
const mwf = { recurring: true, scheduled_date: null, repeat_days: [1, 3, 5] }
const once = { recurring: false, scheduled_date: '2026-10-23', repeat_days: null }
assert.equal(isScheduledOn(daily, '2026-10-21'), true)
assert.equal(isScheduledOn(mwf, '2026-10-21'), true)
assert.equal(isScheduledOn(mwf, '2026-10-22'), false) // Thursday
assert.equal(isScheduledOn({ ...mwf, repeat_days: [] }, '2026-10-22'), true) // empty = every day
assert.equal(isScheduledOn(once, '2026-10-22'), false) // not yet
assert.equal(isScheduledOn(once, '2026-10-23'), true)
assert.equal(isScheduledOn(once, '2026-10-30'), true) // carries over until done
assert.equal(isScheduledOn({ ...daily, scheduled_date: '2026-10-25' }, '2026-10-21'), false) // starts later

// Labels
assert.equal(repeatLabel(null), 'Every day')
assert.equal(repeatLabel([0, 1, 2, 3, 4, 5, 6]), 'Every day')
assert.equal(repeatLabel([5, 1, 2, 3, 4]), 'Weekdays')
assert.equal(repeatLabel([6, 0]), 'Weekends')
assert.equal(repeatLabel([5, 1, 3]), 'Mon · Wed · Fri')
assert.equal(repeatLabel([0, 1]), 'Mon · Sun')

// Levels: 1 at 0, 2 at 100, 3 at 300, 4 at 600, 5 at 1000.
assert.deepEqual(levelFor(0), { level: 1, into: 0, span: 100 })
assert.deepEqual(levelFor(99), { level: 1, into: 99, span: 100 })
assert.deepEqual(levelFor(100), { level: 2, into: 0, span: 200 })
assert.deepEqual(levelFor(710), { level: 4, into: 110, span: 400 })
assert.deepEqual(levelFor(1000), { level: 5, into: 0, span: 500 })

// Habit history. Daily habit started 2026-10-15, done on 16, 18, 19, 20.
const habit = { ...daily, created_at: '2026-10-15T08:00:00Z' }
const done = new Set(['2026-10-16', '2026-10-18', '2026-10-19', '2026-10-20'])
// Today (21st) not done yet → ends yesterday: 15..20 = six days, oldest first.
assert.deepEqual(habitHistory(habit, done, '2026-10-21'), [false, true, false, true, true, true])
// Once today is done it counts: 15..21 → seven.
done.add('2026-10-21')
assert.deepEqual(habitHistory(habit, done, '2026-10-21'), [false, true, false, true, true, true, true])
// Mon/Wed/Fri habit since long ago: last 7 due days before Wed 21st (not done today).
const mwfHabit = { ...mwf, created_at: '2026-01-01T00:00:00Z' }
const mwfDone = new Set(['2026-10-19', '2026-10-16', '2026-10-12', '2026-10-07'])
// Due days back from Mon 19: 19, 16, 14, 12, 9, 7, 5 → reversed.
assert.deepEqual(habitHistory(mwfHabit, mwfDone, '2026-10-21'), [false, true, false, true, false, true, true])

console.log('planner checks passed')
