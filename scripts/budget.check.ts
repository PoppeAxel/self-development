// Asserts src/lib/budget.ts. Run:
//   npx rolldown scripts/budget.check.ts --platform node -f esm -o <tmp>/bc.mjs && node <tmp>/bc.mjs
import assert from 'node:assert/strict'
import {
  bankSavingsEntries,
  BUDGET_CATEGORIES,
  CATEGORY_INFO,
  categoryInfo,
  daysLeft,
  guessCategory,
  HEADS,
  headRows,
  NO_RULES,
  PLANNABLE,
  planRows,
  merchantKey,
  parseAmount,
  parseNordeaCsv,
  payday,
  payMonthOf,
  payPeriod,
  periodBudget,
  type BudgetCategory,
} from '../src/lib/budget'

assert.equal(parseAmount('-1 234,50'), -1234.5)
assert.equal(parseAmount('-1.234,50'), -1234.5)
assert.equal(parseAmount('25000'), 25000)
assert.ok(Number.isNaN(parseAmount('')))

// Current netbank export: semicolons, yyyy/MM/dd, a BOM, a pending row, Rubrik empty → Namn.
const modern = [
  '﻿Bokföringsdag;Belopp;Avsändare;Mottagare;Namn;Rubrik;Saldo;Valuta;',
  'Reserverat;-89,00;;;;Kortköp ICA NARA;;SEK;',
  '2026/10/05;-123,50;;;;Kortköp 261003 ICA NARA;9 000,00;SEK;',
  '2026/10/05;-123,50;;;;Kortköp 261003 ICA NARA;8 876,50;SEK;', // same purchase twice that day
  '2026/10/25;32 000,00;;;ARBETSGIVAREN AB;;40 876,50;SEK;',
].join('\r\n')
const m = parseNordeaCsv(modern)
assert.equal(m.skipped, 1)
assert.equal(m.rows.length, 3)
assert.deepEqual(m.rows[0], { date: '2026-10-05', amount: -123.5, description: 'Kortköp 261003 ICA NARA', import_key: '2026-10-05|-123.5|Kortköp 261003 ICA NARA|0' })
assert.notEqual(m.rows[0].import_key, m.rows[1].import_key)
assert.equal(m.rows[2].description, 'ARBETSGIVAREN AB')
// Re-importing the same file gives the same keys (the DB's unique constraint dedupes).
assert.deepEqual(parseNordeaCsv(modern).rows.map((r) => r.import_key), m.rows.map((r) => r.import_key))

// Older export: commas, quoted "1.234,50" amounts.
const old = parseNordeaCsv('Datum,Transaktion,Kategori,Belopp,Saldo\n2019-05-31,"Kortköp 190529 WILLYS","Mat","-1.234,50","12.345,67"')
assert.deepEqual(old.rows.map((r) => [r.date, r.amount, r.description]), [['2019-05-31', -1234.5, 'Kortköp 190529 WILLYS']])

assert.throws(() => parseNordeaCsv('foo;bar\n1;2'), /date and amount/)

// Categories: keyword guess, short words don't match inside others, learned choice wins.
const none = new Map<string, BudgetCategory>()
assert.equal(guessCategory('Kortköp 261003 ICA NARA', -100, none), 'groceries')
assert.equal(guessCategory('Kortköp SPAR KVARNEN', -100, none), 'groceries')
assert.equal(guessCategory('MUSICA MEDICA', -100, none), 'other')
assert.equal(guessCategory('Överföring Avanza', -5000, none), 'savings')
assert.equal(guessCategory('ARBETSGIVAREN AB', 32000, none), 'income')
assert.equal(guessCategory('Betalning BG CSN Centrala', -1707, none), 'csn') // a repayment, not income
assert.equal(guessCategory('Betalning PG 4173300-7 Nordea Bank', -924, none), 'other_loans')
assert.equal(guessCategory('Kortköp 261022 Revolut**6942*', -5000, none), 'groceries') // his food card
assert.equal(guessCategory('Betalning BG 5552-2635 Ellevio (pub', -265, none), 'electricity')
assert.equal(guessCategory('Betalning PG 4746003-5 Comviq', -134, none), 'phone')
assert.equal(guessCategory('Open Banking BG 5862-8082 AKADEMIKE', -140, none), 'union')
assert.equal(guessCategory('Kortköp ANTHROPIC* CLAUDE SU', -260, none), 'streaming')
assert.equal(guessCategory('Open Banking PG 4809603-6 TRAFIKKON', -500, none), 'fuel_parking')
assert.equal(guessCategory('Kortköp RUTERAPPEN', -40, none), 'public_transport')
assert.equal(guessCategory('Kortköp THE LIFFEY', -255, none), 'going_out')
assert.equal(guessCategory('Kortköp BRASSERIE ASTORIA', -1209, none), 'eating_out')
assert.equal(guessCategory('Lön', -500, none), 'other') // money out is never income
assert.equal(guessCategory('Open Banking BG HSB Stockh', -4463, none), 'housing')
assert.equal(guessCategory('Swish återbetalning Boozt Fashion A', 839, none), 'clothes') // refund nets clothes
// Every subcategory sits in exactly one head and is fixed or variable.
for (const h of HEADS) for (const s of h.subs) assert.equal(CATEGORY_INFO[s].head, h.id)
assert.ok(PLANNABLE.every((c) => ['fixed', 'variable'].includes(CATEGORY_INFO[c].group)))
assert.equal(new Set(BUDGET_CATEGORIES).size, BUDGET_CATEGORIES.length)
assert.equal(categoryInfo('bills').label, 'Other') // an id from before the split reads as Other
assert.equal(merchantKey('Kortköp 261003 ICA NARA'), merchantKey('Kortköp 261117 ICA NARA'))
const learned = new Map<string, BudgetCategory>([[merchantKey('Kortköp 261003 ICA NARA'), 'eating_out']])
assert.equal(guessCategory('Kortköp 261117 ICA NARA', -50, learned), 'eating_out')

// Payday: the salary row's date wins; without one, the 22nd, or the 23rd when that's a Sunday.
const salary = (date: string) => ({ date, description: 'Lön', amount: 36000 })
assert.equal(payday('2026-10', [salary('2026-10-22')]), '2026-10-22')
assert.equal(payday('2026-11', [salary('2026-11-20')]), '2026-11-20') // paid early before a weekend
assert.equal(payday('2026-11', []), '2026-11-23') // 22 Nov 2026 is a Sunday
assert.equal(payday('2026-10', []), '2026-10-22') // a Thursday
assert.equal(payday('2026-12', [{ date: '2026-12-05', description: 'Swish Lönnberg', amount: 100 }]), '2026-12-22') // \b keeps "Lönnberg" out
// Period = payday → day before next payday (next one known from data, else the default).
assert.deepEqual(payPeriod('2026-10', [salary('2026-10-22'), salary('2026-11-20')]), { start: '2026-10-22', end: '2026-11-19' })
assert.deepEqual(payPeriod('2026-10', [salary('2026-10-22')]), { start: '2026-10-22', end: '2026-11-22' }) // 23 Nov default
assert.deepEqual(payPeriod('2026-12', []), { start: '2026-12-22', end: '2027-01-21' }) // year wrap
assert.equal(payMonthOf('2026-10-23'), '2026-10')
assert.equal(payMonthOf('2026-11-05'), '2026-10')
assert.equal(payMonthOf('2026-01-10'), '2025-12')

// Period: income − saved − fixed − variable; refunds net; shared costs paid back net (can go
// negative); transfers ignored; outside dates ignored.
const b = periodBudget(
  [
    { date: '2026-10-25', amount: 32000, category: 'income' },
    { date: '2026-10-26', amount: -5000, category: 'savings' },
    { date: '2026-10-05', amount: -1200, category: 'groceries' },
    { date: '2026-10-06', amount: -800, category: 'shopping' },
    { date: '2026-10-07', amount: 300, category: 'shopping' }, // refund
    { date: '2026-10-08', amount: -10000, category: 'transfer' },
    { date: '2026-10-09', amount: -4463, category: 'housing' },
    { date: '2026-10-10', amount: -1707, category: 'csn' },
    { date: '2026-10-11', amount: 2500, category: 'shared' }, // Swish back
    { date: '2026-10-12', amount: -200, category: 'shared' },
    { date: '2026-10-13', amount: -99, category: 'bills' as BudgetCategory }, // pre-split id → Other
    { date: '2026-09-30', amount: -999, category: 'groceries' },
  ],
  '2026-10-01',
  '2026-10-31',
  NO_RULES,
)
assert.equal(b.income, 32000)
assert.equal(b.saved, 5000)
assert.equal(b.fixed, 6170)
assert.equal(b.variable, 1799) // shared money back doesn't hide inside one group
assert.equal(b.sharedBack, 2300)
assert.equal(b.left, 32000 - 5000 - 6170 - 1799 + 2300)
assert.deepEqual(b.byCategory, [
  { category: 'housing', amount: 4463 },
  { category: 'csn', amount: 1707 },
  { category: 'groceries', amount: 1200 },
  { category: 'shopping', amount: 500 },
  { category: 'other', amount: 99 },
])

// Split rules — his real setup: Avanza autogiros 3000/2500/2500/1000/500/250/250 = 2 500 buffer
// + 500 car + 1 000 travel + 6 000 ETF; mortgage 1 386 amortization + varying interest.
const rules = { buffers: { buffer: 2500, car_buffer: 500, travel_buffer: 1000 }, amortizationPerMonth: 1386 }
const avanza = [3000, 2500, 2500, 1000, 500, 250, 250].map((a) => ({ date: '2026-10-23', amount: -a, category: 'savings' as const }))
const sum = (es: { account: string; amount: number }[], account: string) => es.filter((e) => e.account === account).reduce((s, e) => s + e.amount, 0)
const oct = bankSavingsEntries([...avanza, { date: '2026-10-28', amount: -6236, category: 'mortgage' as const }], rules)
assert.equal(sum(oct, 'buffer'), 2500)
assert.equal(sum(oct, 'car_buffer'), 500)
assert.equal(sum(oct, 'travel_buffer'), 1000)
assert.equal(sum(oct, 'investments'), 6000)
assert.equal(sum(oct, 'mortgage'), 1386)
// Each pay period fills its buffers again; an extra deposit later in a period is ETF.
const two = bankSavingsEntries([...avanza, ...avanza.map((t) => ({ ...t, date: '2026-11-23' })), { date: '2026-11-30', amount: -700, category: 'savings' as const }], rules)
assert.equal(sum(two, 'buffer') + sum(two, 'car_buffer') + sum(two, 'travel_buffer'), 8000)
assert.equal(sum(two, 'investments'), 12700)
// Less in than the buffers take: they fill in order (buffer, car, travel), nothing to ETF.
const short = bankSavingsEntries([{ date: '2026-10-23', amount: -2800, category: 'savings' }], rules)
assert.deepEqual([sum(short, 'buffer'), sum(short, 'car_buffer'), sum(short, 'travel_buffer'), sum(short, 'investments')], [2500, 300, 0, 0])
// Money taken back out of savings comes off the main buffer.
assert.equal(sum(bankSavingsEntries([{ date: '2026-12-01', amount: 2000, category: 'savings' }], rules), 'buffer'), -2000)

// Budget with the rules: amortization is saved, only interest is a fixed cost.
const p = periodBudget([...avanza, { date: '2026-10-28', amount: -6236, category: 'mortgage' }, { date: '2026-10-22', amount: 34117, category: 'income' }], '2026-10-22', '2026-11-22', rules)
assert.deepEqual(p.savedByAccount, { buffer: 2500, car_buffer: 500, travel_buffer: 1000, investments: 6000, mortgage: 1386 })
assert.equal(p.saved, 11386)
assert.equal(p.fixed, 4850) // 6236 − 1386 interest
assert.deepEqual(p.byCategory, [{ category: 'mortgage', amount: 4850 }])
assert.equal(p.left, 34117 - 11386 - 4850)
assert.equal(guessCategory('Omsättning lån 3990 12 34567', -6236, none), 'mortgage')

// Plan: targets show even with no spending yet; spending without a target keeps target null;
// income/savings/shared never become plan rows; rows come in head order.
const plan = planRows(
  { byCategory: [{ category: 'groceries', amount: 3200 }, { category: 'shopping', amount: 2001 }, { category: 'mortgage', amount: 4850 }] },
  { groceries: 5000, eating_out: 1500, mortgage: 5000, savings: 9999 } as Parameters<typeof planRows>[1],
)
assert.deepEqual(plan, [
  { category: 'mortgage', actual: 4850, target: 5000 },
  { category: 'groceries', actual: 3200, target: 5000 },
  { category: 'eating_out', actual: 0, target: 1500 },
  { category: 'shopping', actual: 2001, target: null },
])
assert.deepEqual(planRows({ byCategory: [] }, { groceries: 0 }), []) // a cleared target is no target

// Heads roll up their subs; a head's target sums only the subs that have one, null if none.
const heads = headRows([
  { category: 'housing', actual: 4463, target: 4500 },
  { category: 'household', actual: 300, target: null },
  { category: 'groceries', actual: 3200, target: 5000 },
  { category: 'eating_out', actual: 800, target: 1500 },
  { category: 'clothes', actual: 600, target: null },
])
assert.deepEqual(
  heads.map((h) => [h.head, h.actual, h.target, h.subs.length]),
  [
    ['home', 4763, 4500, 2],
    ['food', 4000, 6500, 2],
    ['shopping', 600, null, 1],
  ],
)

assert.equal(daysLeft('2026-10-23', '2026-11-22', '2026-10-22'), 31)
assert.equal(daysLeft('2026-11-22', '2026-11-22', '2026-10-22'), 1) // last day counts
assert.equal(daysLeft('2026-11-23', '2026-11-22', '2026-10-22'), null) // a past period
assert.equal(daysLeft('2026-03-29', '2026-04-21', '2026-03-23'), 24) // across the DST switch

console.log('budget.check: ok')
