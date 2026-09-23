// Self-check for the pure Training functions. Run:
//   npx rolldown scripts/training.check.ts --platform node -f esm -o $TMP/tc.mjs && node $TMP/tc.mjs
import assert from 'node:assert/strict'
import { autoLinks, nextProgram, paceTrend, paceTrendLabel, planCaption, regionBalance, weekStrip } from '../src/lib/training'
import type { GoalPace } from '../src/lib/goals'

const ex = (name: string, primary: string | null, secondary: string | null = null) =>
  [name.toLowerCase(), { id: name, user_id: '', name, primary_muscle: primary, secondary_muscle: secondary, created_at: '' }] as const
const byName = new Map([ex('Bench', 'Chest', 'Triceps'), ex('Row', 'Upper back', 'Lower back')])
const session = (id: string, date: string, extra = {}) => ({ id, user_id: '', program_id: null, program_name: null, date, created_at: '', strava_workout_id: null, ...extra })
const set = (session_id: string, exercise_name: string) => ({ id: '', user_id: '', session_id, exercise_name, set_number: 1, reps: 5, weight: 100, created_at: '' })

// Balance: bench counts Chest 1 + Arms 0.5; row's secondary is the same region, so Back 1 only.
const bal = regionBalance([session('a', '2026-09-20')], [set('a', 'Bench'), set('a', 'Row')], byName, '2026-09-23', 1)
assert.equal(bal.find((r) => r.region === 'Chest')!.perWeek, 1)
assert.equal(bal.find((r) => r.region === 'Arms')!.perWeek, 0.5)
assert.equal(bal.find((r) => r.region === 'Back')!.perWeek, 1)
// Outside the 4-week window → ignored; empty weeks still divide.
assert.equal(regionBalance([session('b', '2026-08-01')], [set('b', 'Bench')], byName, '2026-09-23')[1].perWeek, 0)

// Week strip: nulls for empty days, today/future flags.
const w = (date: string, sport_type: string, km: number, secs = 1800) =>
  ({ id: date + sport_type + km, user_id: '', strava_id: 0, sport_type, name: '', date, duration_seconds: secs, distance_meters: km * 1000, calories: null, created_at: '' })
const strip = weekStrip('2026-09-21', [session('a', '2026-09-21')], [set('a', 'Bench'), set('a', 'Row')], [w('2026-09-22', 'Run', 8.2)], '2026-09-23')
assert.deepEqual(strip.slice(0, 3).map((d) => [d.strengthSets, d.cardioKm]), [[2, null], [null, 8.2], [null, null]])
assert.ok(strip[2].isToday && strip[3].isFuture)

// Pace: runs get faster = lower s/km; five runs needed for a delta.
const runs = [330, 330, 330, 330, 320].map((spk, i) => w(`2026-09-0${i +1}`, 'Run', 5, spk * 5))
const run = paceTrend(runs, 'Run', '2026-09-23')!
assert.equal(run.unit, 'min/km')
assert.equal(paceTrendLabel(run)!.text, '→ steady') // 2.5 s change < 5 s
assert.equal(paceTrend(runs.slice(0, 2), 'Run', '2026-09-23'), null)
assert.equal(paceTrendLabel({ current: 324, deltaVs8wAgo: -9, unit: 'min/km' })!.text, '↗ 9 s faster')

// Auto-link only when unambiguous.
const sw = w('2026-09-20', 'WeightTraining', 0)
assert.deepEqual(autoLinks([session('a', '2026-09-20')], [sw]), [{ sessionId: 'a', workoutId: sw.id }])
assert.deepEqual(autoLinks([session('a', '2026-09-20'), session('b', '2026-09-20')], [sw]), [])
assert.deepEqual(autoLinks([session('a', '2026-09-20')], [sw, { ...sw, id: 'other' }]), [])

// Next program wraps round.
const progs = [{ id: 'p1', name: 'Push' }, { id: 'p2', name: 'Legs' }].map((p) => ({ ...p, user_id: '', created_at: '' }))
assert.equal(nextProgram(progs, [session('x', '2026-09-20', { program_id: 'p2' })])!.name, 'Push')
assert.equal(nextProgram(progs, [])!.name, 'Push')

// Hero caption.
const pace = (delta: number, daysLeft = 2) => ({ delta, onPace: Math.abs(delta) <= 1.25, daysLeft }) as GoalPace
assert.equal(planCaption(pace(-3.7), 25, 14.2, 'km', 12), '3.7 km behind pace · a 11 km run closes it')
assert.equal(planCaption(pace(-3.7), 25, 14.2, 'km', 5), '3.7 km behind pace')
assert.equal(planCaption({ delta: -0.14, onPace: true, daysLeft: 2 } as GoalPace, 3, 2, 'sessions', null), 'On pace · one more by Sunday')
console.log('training.check: ok')
