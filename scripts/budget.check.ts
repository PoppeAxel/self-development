// Asserts src/lib/budget.ts. Run:
//   npx rolldown scripts/budget.check.ts --platform node -f esm -o <tmp>/bc.mjs && node <tmp>/bc.mjs
import assert from 'node:assert/strict'
import { guessCategory, merchantKey, monthBudget, parseAmount, parseNordeaCsv, type BudgetCategory } from '../src/lib/budget'

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
assert.equal(merchantKey('Kortköp 261003 ICA NARA'), merchantKey('Kortköp 261117 ICA NARA'))
const learned = new Map<string, BudgetCategory>([[merchantKey('Kortköp 261003 ICA NARA'), 'eating_out']])
assert.equal(guessCategory('Kortköp 261117 ICA NARA', -50, learned), 'eating_out')

// Month: income − saved − spent; refunds net; transfers ignored; other months ignored.
const b = monthBudget(
  [
    { date: '2026-10-25', amount: 32000, category: 'income' },
    { date: '2026-10-26', amount: -5000, category: 'savings' },
    { date: '2026-10-05', amount: -1200, category: 'groceries' },
    { date: '2026-10-06', amount: -800, category: 'shopping' },
    { date: '2026-10-07', amount: 300, category: 'shopping' }, // refund
    { date: '2026-10-08', amount: -10000, category: 'transfer' },
    { date: '2026-09-30', amount: -999, category: 'groceries' },
  ],
  '2026-10',
)
assert.equal(b.income, 32000)
assert.equal(b.saved, 5000)
assert.equal(b.spent, 1700)
assert.equal(b.left, 25300)
assert.deepEqual(b.byCategory, [
  { category: 'groceries', amount: 1200 },
  { category: 'shopping', amount: 500 },
])

console.log('budget.check: ok')
