// Asserts src/lib/finance.ts. Run:
//   npx rolldown scripts/finance.check.ts --platform node -f esm -o <tmp>/fc.mjs && node <tmp>/fc.mjs
import assert from 'node:assert/strict'
import { periodTotals, potProgress, swapNeighbour } from '../src/lib/finance'

const entries = [
  { date: '2026-09-25', account: 'buffer' as const, amount: 5000 },
  { date: '2026-10-01', account: 'buffer' as const, amount: 3000 },
  { date: '2026-10-01', account: 'mortgage' as const, amount: 2000 },
  { date: '2026-10-02', account: 'investments' as const, amount: 4000 },
  { date: '2026-10-03', account: 'buffer' as const, amount: -1500 }, // withdrawal
  { date: '2026-11-01', account: 'investments' as const, amount: 9999 }, // outside
]

const oct = periodTotals(entries, '2026-10-01', '2026-10-31')
assert.deepEqual(oct.byAccount, { buffer: 1500, mortgage: 2000, investments: 4000 })
assert.equal(oct.withdrawn, 1500)
assert.equal(oct.net, 7500)

// Both ends inclusive; numeric strings (as Postgres numerics arrive) still add up.
const q = periodTotals([...entries, { date: '2026-12-31', account: 'buffer' as const, amount: '100' as unknown as number }], '2026-10-01', '2026-12-31')
assert.equal(q.net, 7500 + 9999 + 100)

// Pots: ring 45 000 by June 2027, 12 000 in (one take-out), today 4 Oct 2026 → 9 months incl. Oct.
const ring = { id: 'ring', target_amount: 45000, target_date: '2027-06-30' }
const potEntries = [
  { pot_id: 'ring', amount: 10000 },
  { pot_id: 'ring', amount: 3000 },
  { pot_id: 'ring', amount: -1000 },
  { pot_id: 'watch', amount: 99999 },
]
const p = potProgress(ring, potEntries, '2026-10-04')
assert.equal(p.saved, 12000)
assert.equal(p.remaining, 33000)
assert.equal(p.monthsLeft, 9)
assert.equal(p.perMonth, 3667) // ceil(33000 / 9)
assert.equal(potProgress({ ...ring, target_date: null }, potEntries, '2026-10-04').perMonth, null)
assert.equal(potProgress({ ...ring, target_date: '2026-08-01' }, potEntries, '2026-10-04').monthsLeft, 1) // overdue → due now
assert.equal(potProgress({ ...ring, target_amount: 12000 }, potEntries, '2026-10-04').perMonth, null) // reached

// Shopping list order: move within what's shown, null at the ends.
const shown = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
assert.equal(swapNeighbour(shown, 'b', -1)?.id, 'a')
assert.equal(swapNeighbour(shown, 'b', 1)?.id, 'c')
assert.equal(swapNeighbour(shown, 'a', -1), null)
assert.equal(swapNeighbour(shown, 'c', 1), null)

console.log('finance.check: ok')
