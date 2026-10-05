// Asserts supabase/functions/send-reminders/localTime.ts. Run:
//   npx rolldown scripts/reminders.check.ts --platform node -f esm -o <tmp>/rc.mjs && node <tmp>/rc.mjs
import assert from 'node:assert/strict'
import { isDue, localParts } from '../supabase/functions/send-reminders/localTime'

const TZ = 'Europe/Stockholm'
const ALL = [0, 1, 2, 3, 4, 5, 6]

// Summer (CEST, UTC+2) and winter (CET, UTC+1): 22:00 local both times.
const summer = localParts(new Date('2026-10-05T20:00:00Z'), TZ)
assert.deepEqual(summer, { date: '2026-10-05', day: 1, minutes: 22 * 60 })
const winter = localParts(new Date('2026-11-02T21:00:00Z'), TZ)
assert.deepEqual(winter, { date: '2026-11-02', day: 1, minutes: 22 * 60 })
assert.ok(isDue('22:00:00', ALL, summer))
assert.ok(isDue('22:00:00', ALL, winter))

// Window is [time, time + 15): fires once on the quarter-hour, not again on the next run.
const at = (h: number, m: number, day = 1) => ({ day, minutes: h * 60 + m })
assert.ok(isDue('06:15', ALL, at(6, 15)))
assert.ok(!isDue('06:15', ALL, at(6, 30)))
assert.ok(isDue('06:20', ALL, at(6, 30)))
assert.ok(!isDue('06:31', ALL, at(6, 30)))

// Day filter, including a 23:55 Monday reminder caught by Tuesday's 00:00 run.
assert.ok(!isDue('22:00', [0, 2], at(22, 0, 1)))
assert.ok(isDue('23:55', [1], at(0, 0, 2)))
assert.ok(!isDue('23:55', [2], at(0, 0, 2)))
assert.ok(isDue('23:55', [6], at(0, 0, 0))) // Sat → Sun wrap

console.log('reminders.check: ok')
