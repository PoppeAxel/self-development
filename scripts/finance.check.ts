// Asserts src/lib/finance.ts. Run:
//   npx rolldown scripts/finance.check.ts --platform node -f esm -o <tmp>/fc.mjs && node <tmp>/fc.mjs
import assert from 'node:assert/strict'
import { periodTotals } from '../src/lib/finance'

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

console.log('finance.check: ok')
