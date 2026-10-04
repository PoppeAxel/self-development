// Asserts the pure goal helpers in src/lib/checkins.ts. Run:
//   npx rolldown scripts/goals.check.ts --platform node -f esm -o <tmp>/gc.mjs && node <tmp>/gc.mjs
import assert from 'node:assert/strict'
import { formatGoalValue, formatSeconds, historyDots, milestoneState, parseGoalValue, reviewPeriod, suggestRating } from '../src/lib/checkins'
import type { Goal, GoalCheckin } from '../src/lib/types'

// Values
assert.equal(formatSeconds(3 * 3600 + 14 * 60 + 20), '3:14:20')
assert.equal(formatSeconds(42 * 60 + 5), '42:05')
assert.equal(parseGoalValue('3:00', true), 10800) // h:mm for a race goal
assert.equal(parseGoalValue('3:14:20', true), 11660)
assert.equal(parseGoalValue('97,5', false), 97.5)
assert.equal(parseGoalValue('abc', false), null)

// Milestone: bench 80 → 100, best 92.5 now, 90 before October.
const bench = { lower_is_better: false, start_value: 80, target_value: 100 }
const lifts = [
  { date: '2026-02-01', value: 85 },
  { date: '2026-09-10', value: 90 },
  { date: '2026-10-02', value: 92.5, reps: 3 },
]
const m = milestoneState(bench, lifts, '2026-10-01')
assert.equal(m.best?.value, 92.5)
assert.equal(m.gain, 2.5)
assert.equal(m.toGo, 7.5)
assert.equal(m.basePct, 50) // 80→90 of 80→100
assert.equal(m.gainPct, 12.5)

// Lower is better: marathon 3:30 → 3:00, best 3:14:20.
const race = { lower_is_better: true, start_value: 12600, target_value: 10800 }
const rm = milestoneState(race, [{ date: '2026-05-01', value: 11660 }], '2026-10-01')
assert.equal(rm.toGo, 860)
assert.ok(rm.basePct > 52 && rm.basePct < 53) // 940 of 1800 seconds improved
assert.equal(milestoneState(race, [], '2026-10-01').best, null)

// Weight goal (≤ 90, from 95): the LATEST weigh-in counts, not the lightest ever.
const weightGoal = { lower_is_better: true, start_value: 95, target_value: 90, auto_metric: 'weight' }
const weighIns = [
  { date: '2026-08-01', value: 89.5 }, // lightest, but long ago
  { date: '2026-09-20', value: 93 },
  { date: '2026-10-02', value: 92 },
]
const w = milestoneState(weightGoal, weighIns, '2026-10-01')
assert.equal(w.best?.value, 92)
assert.equal(w.toGo, 2)
assert.equal(w.gain, 1) // 93 → 92 since 1 Oct
assert.equal(formatGoalValue({ ...weightGoal, source_exercise: null }, 92), '92 kg') // kg, not h:mm:ss despite lower_is_better
assert.equal(milestoneState(weightGoal, [...weighIns, { date: '2026-10-03', value: 89.8 }], '2026-10-01').toGo, 0)

// Review period: Sat 3 Oct → previous week/month; Sun 4 Oct → this week; 31 Oct → this month.
assert.deepEqual(reviewPeriod('week', new Date('2026-10-03T12:00')), { start: '2026-09-21', isCurrent: false })
assert.deepEqual(reviewPeriod('week', new Date('2026-10-04T12:00')), { start: '2026-09-28', isCurrent: true })
assert.deepEqual(reviewPeriod('month', new Date('2026-10-03T12:00')), { start: '2026-09-01', isCurrent: false })
assert.deepEqual(reviewPeriod('month', new Date('2026-10-31T12:00')), { start: '2026-10-01', isCurrent: true })

// Suggested rating
assert.equal(suggestRating({ status: 'active', target_value: 3 }, 3), 'done')
assert.equal(suggestRating({ status: 'active', target_value: 3 }, 2), 'partly')
assert.equal(suggestRating({ status: 'active', target_value: 3 }, 0), 'missed')
assert.equal(suggestRating({ status: 'active', target_value: null }, 0), null)
assert.equal(suggestRating({ status: 'done', target_value: null }, 0), 'done')

// History dots: only weeks the series existed, oldest first, no check-in = missed.
const g = (id: string, period_start: string) => ({ id, period_start }) as Goal
const series = [g('a', '2026-09-14'), g('b', '2026-09-21'), g('c', '2026-09-28'), g('d', '2026-10-05')]
const checkins = new Map([
  ['a', { rating: 'done' } as GoalCheckin],
  ['b', { rating: 'partly' } as GoalCheckin],
])
assert.deepEqual(historyDots(series, checkins, '2026-10-05'), ['done', 'partly', 'missed'])

console.log('goals.check: ok')
