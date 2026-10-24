// Asserts src/lib/budget.ts. Run:
//   npx rolldown scripts/budget.check.ts --platform node -f esm -o <tmp>/bc.mjs && node <tmp>/bc.mjs
import assert from 'node:assert/strict'
import {
  bankSavingsEntries,
  makeCatalog,
  categoryInfo,
  daysLeft,
  guessCategory,
  headRows,
  NO_RULES,
  plannable,
  planRows,
  splitCard,
  merchantKey,
  parseAmount,
  parseNordeaCsv,
  payday,
  payMonthOf,
  payPeriod,
  periodBudget,
  type BudgetCategory,
} from '../src/lib/budget'
import type { OptionRow } from '../src/lib/editable'
import fixture from './budget.fixture.json'

// The catalog exactly as migration 0048 seeded it (dumped from the DB), so these asserts run
// against the real keyword list, not a copy of it.
const rows = (fixture as Omit<OptionRow, 'id' | 'icon' | 'color' | 'archived_at'>[]).map((r, i) => ({ icon: null, color: null, archived_at: null, ...r, id: 'f' + i }) as OptionRow)
const cat = makeCatalog(rows)

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
assert.equal(guessCategory('Kortköp 261003 ICA NARA', -100, none, cat), 'groceries')
assert.equal(guessCategory('Kortköp SPAR KVARNEN', -100, none, cat), 'groceries')
assert.equal(guessCategory('MUSICA MEDICA', -100, none, cat), 'other')
assert.equal(guessCategory('Överföring Avanza', -5000, none, cat), 'savings')
assert.equal(guessCategory('ARBETSGIVAREN AB', 32000, none, cat), 'income')
assert.equal(guessCategory('Betalning BG CSN Centrala', -1707, none, cat), 'csn') // a repayment, not income
assert.equal(guessCategory('Betalning PG 4173300-7 Nordea Bank', -924, none, cat), 'other_loans')
assert.equal(guessCategory('Kortköp 261022 Revolut**6942*', -5000, none, cat), 'card') // his spending card
assert.equal(guessCategory('Betalning BG 5552-2635 Ellevio (pub', -265, none, cat), 'electricity')
assert.equal(guessCategory('Betalning PG 4746003-5 Comviq', -134, none, cat), 'phone')
assert.equal(guessCategory('Open Banking BG 5862-8082 AKADEMIKE', -140, none, cat), 'union')
assert.equal(guessCategory('Kortköp ANTHROPIC* CLAUDE SU', -260, none, cat), 'streaming')
assert.equal(guessCategory('Open Banking PG 4809603-6 TRAFIKKON', -500, none, cat), 'fuel_parking')
assert.equal(guessCategory('Kortköp RUTERAPPEN', -40, none, cat), 'public_transport')
assert.equal(guessCategory('Kortköp THE LIFFEY', -255, none, cat), 'going_out')
assert.equal(guessCategory('Kortköp BRASSERIE ASTORIA', -1209, none, cat), 'eating_out')
assert.equal(guessCategory('Lön', -500, none, cat), 'other') // money out is never income
assert.equal(guessCategory('Open Banking BG HSB Stockh', -4463, none, cat), 'housing')
assert.equal(guessCategory('Swish återbetalning Boozt Fashion A', 839, none, cat), 'clothes') // refund nets clothes
// Every subcategory sits in exactly one head and is fixed or variable.
const headKeys = new Set(cat.heads.map((h) => h.key))
for (const s of cat.subs) assert.ok(headKeys.has(s.head), s.key)
assert.ok(plannable(cat).every((c) => ['fixed', 'variable'].includes(categoryInfo(cat, c).group)))
assert.equal(new Set(plannable(cat)).size, plannable(cat).length)
assert.deepEqual([cat.heads.length, cat.subs.length, cat.keywords.length], [9, 22, 24])
assert.equal(categoryInfo(cat, 'bills').label, 'Other') // an id from before the split reads as Other

// Edited in place: an archived sub keeps its name for old rows but leaves pickers and plans,
// and keywords pointing at it stop guessing it; a pattern that doesn't compile is skipped.
const edited = makeCatalog([
  ...rows.map((r) => (r.kind === 'budget_sub' && r.key === 'clothes' ? { ...r, archived_at: '2026-10-24T10:00:00Z' } : r)),
  { ...rows[0], id: 'bad', kind: 'budget_keyword', key: 'bad', label: '(unclosed', position: -1, meta: { category: 'gym' } },
])
assert.equal(categoryInfo(edited, 'clothes').label, 'Clothes')
assert.ok(!plannable(edited).includes('clothes'))
assert.equal(guessCategory('Kortköp BOOZT', -500, none, edited), 'other')
assert.equal(edited.keywords.length, 23)
assert.equal(merchantKey('Kortköp 261003 ICA NARA'), merchantKey('Kortköp 261117 ICA NARA'))
const learned = new Map<string, BudgetCategory>([[merchantKey('Kortköp 261003 ICA NARA'), 'eating_out']])
assert.equal(guessCategory('Kortköp 261117 ICA NARA', -50, learned, cat), 'eating_out')

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
  cat,
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
const rules = { buffers: { buffer: 2500, car_buffer: 500, travel_buffer: 1000 }, amortizationPerMonth: 1386, card: {} }
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
const p = periodBudget([...avanza, { date: '2026-10-28', amount: -6236, category: 'mortgage' }, { date: '2026-10-22', amount: 34117, category: 'income' }], '2026-10-22', '2026-11-22', rules, cat)
assert.deepEqual(p.savedByAccount, { buffer: 2500, car_buffer: 500, travel_buffer: 1000, investments: 6000, mortgage: 1386 })
assert.equal(p.saved, 11386)
assert.equal(p.fixed, 4850) // 6236 − 1386 interest
assert.deepEqual(p.byCategory, [{ category: 'mortgage', amount: 4850 }])
assert.equal(p.left, 34117 - 11386 - 4850)
assert.equal(guessCategory('Omsättning lån 3990 12 34567', -6236, none, cat), 'mortgage')

// Plan: targets show even with no spending yet; spending without a target keeps target null;
// income/savings/shared never become plan rows; rows come in head order.
const plan = planRows(
  { byCategory: [{ category: 'groceries', amount: 3200 }, { category: 'shopping', amount: 2001 }, { category: 'mortgage', amount: 4850 }] },
  { groceries: 5000, eating_out: 1500, mortgage: 5000, savings: 9999 },
  cat,
)
assert.deepEqual(plan, [
  { category: 'mortgage', actual: 4850, target: 5000 },
  { category: 'groceries', actual: 3200, target: 5000 },
  { category: 'eating_out', actual: 0, target: 1500 },
  { category: 'shopping', actual: 2001, target: null },
])
assert.deepEqual(planRows({ byCategory: [] }, { groceries: 0 }, cat), []) // a cleared target is no target

// Heads roll up their subs; a head's target sums only the subs that have one, null if none.
const heads = headRows([
  { category: 'housing', actual: 4463, target: 4500 },
  { category: 'household', actual: 300, target: null },
  { category: 'groceries', actual: 3200, target: 5000 },
  { category: 'eating_out', actual: 800, target: 1500 },
  { category: 'clothes', actual: 600, target: null },
], cat)
assert.deepEqual(
  heads.map((h) => [h.head.key, h.actual, h.target, h.subs.length]),
  [
    ['home', 4763, 4500, 2],
    ['food', 4000, 6500, 2],
    ['shopping', 600, null, 1],
  ],
)
// Edit mode lists every live head and sub, empty ones as 0.
const all = headRows([{ category: 'groceries', actual: 3200, target: null }], cat, true)
assert.equal(all.length, 9)
assert.deepEqual(all[1].subs, [{ category: 'groceries', actual: 3200, target: null }, { category: 'eating_out', actual: 0, target: null }])

assert.equal(daysLeft('2026-10-23', '2026-11-22', '2026-10-22'), 31)
assert.equal(daysLeft('2026-11-22', '2026-11-22', '2026-10-22'), 1) // last day counts
assert.equal(daysLeft('2026-11-23', '2026-11-22', '2026-10-22'), null) // a past period
assert.equal(daysLeft('2026-03-29', '2026-04-21', '2026-03-23'), 24) // across the DST switch

// Card top-ups: his 3 000 food / 1 500 fuel / 500 shopping. Exactly 5 000 fills all three; more
// spills into Other; less fills in order; split is per period over the sum of top-ups.
const card = { groceries: 3000, fuel_parking: 1500, shopping: 500 }
assert.deepEqual(splitCard(5000, card, cat), [
  { category: 'groceries', amount: 3000 },
  { category: 'fuel_parking', amount: 1500 },
  { category: 'shopping', amount: 500 },
])
assert.deepEqual(splitCard(6200, card, cat).at(-1), { category: 'other', amount: 1200 })
assert.deepEqual(splitCard(3500, card, cat), [
  { category: 'groceries', amount: 3000 },
  { category: 'fuel_parking', amount: 500 },
])
assert.deepEqual(splitCard(0, card, cat), [])
const withCard = periodBudget(
  [
    { date: '2026-10-22', amount: -3000, category: 'card' },
    { date: '2026-11-05', amount: -2000, category: 'card' },
    { date: '2026-10-25', amount: -400, category: 'groceries' }, // a Nordea-card ICA visit adds to the same sub
  ],
  '2026-10-22',
  '2026-11-22',
  { ...NO_RULES, card },
  cat,
)
assert.deepEqual(withCard.byCategory, [
  { category: 'groceries', amount: 3400 },
  { category: 'fuel_parking', amount: 1500 },
  { category: 'shopping', amount: 500 },
])
assert.equal(withCard.variable, 5400)
assert.ok(!plannable(cat).includes('card')) // the top-up itself is never planned — its subs are

console.log('budget.check: ok')
