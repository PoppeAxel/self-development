// Finance → Budget: Nordea CSV export → bank_transactions. Pure — no supabase import —
// so scripts/budget.check.ts can run it under node.

import type { SavingsAccount } from './finance'

// Order = how the category picker lists them, grouped. Ids are stored in bank_transactions.category.
export const BUDGET_CATEGORIES = [
  'income',
  'savings',
  'housing',
  'mortgage',
  'loans',
  'bills',
  'subscriptions',
  'groceries',
  'eating_out',
  'transport',
  'shopping',
  'health',
  'shared',
  'other',
  'transfer',
] as const
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number]
export type BudgetGroup = 'income' | 'saved' | 'fixed' | 'variable' | 'shared' | 'ignored'

export const GROUP_LABEL: Record<BudgetGroup, string> = { income: 'Income', saved: 'Saved', fixed: 'Fixed costs', variable: 'Variable', shared: 'Shared', ignored: 'Ignored' }

export const CATEGORY_INFO: Record<BudgetCategory, { label: string; icon: string; color: string; group: BudgetGroup }> = {
  income: { label: 'Income', icon: '💰', color: '#2f6b5a', group: 'income' },
  // Split by SplitRules into buffer / ETF & stocks (see bankSavingsEntries).
  savings: { label: 'Savings (Avanza)', icon: '🏦', color: '#46608f', group: 'saved' },
  housing: { label: 'Housing', icon: '🏠', color: '#8a5a44', group: 'fixed' },
  // The payment row; its amortization part counts as saved, only the interest as a cost.
  mortgage: { label: 'Mortgage', icon: '🔑', color: '#a0674f', group: 'fixed' },
  loans: { label: 'Loans & CSN', icon: '🎓', color: '#6b5a8a', group: 'fixed' },
  bills: { label: 'Bills (power, phone, insurance)', icon: '💡', color: '#7a6aa8', group: 'fixed' },
  subscriptions: { label: 'Subscriptions', icon: '📺', color: '#5b7fa6', group: 'fixed' },
  groceries: { label: 'Groceries & household', icon: '🛒', color: '#3f9a6b', group: 'variable' },
  eating_out: { label: 'Eating out', icon: '🍔', color: '#c0703a', group: 'variable' },
  transport: { label: 'Transport', icon: '🚗', color: '#4f7f8c', group: 'variable' },
  shopping: { label: 'Shopping', icon: '🛍️', color: '#a8842f', group: 'variable' },
  health: { label: 'Health & training', icon: '💪', color: '#b45a6e', group: 'variable' },
  // Swish to/from his partner for split costs. Her share covers rent as well as food, so it
  // nets against the total (left over), not against any one group.
  shared: { label: 'Shared costs', icon: '🤝', color: '#9a7b5f', group: 'shared' },
  other: { label: 'Other', icon: '📦', color: '#8c8577', group: 'variable' },
  // Moves between his own accounts: counted nowhere.
  transfer: { label: 'Own transfer (ignored)', icon: '↔️', color: '#b9b2a4', group: 'ignored' },
}

export interface BankTransaction {
  id: string
  date: string
  /** Negative = money out. */
  amount: number
  description: string
  category: BudgetCategory
}

export interface ParsedRow {
  date: string
  amount: number
  description: string
  import_key: string
}

// Card rows read "Kortköp 241005 ICA NARA" — drop digits so every ICA visit shares one key.
export const merchantKey = (description: string) => description.toLowerCase().replace(/[\d/.,:-]+/g, ' ').replace(/\s+/g, ' ').trim()

const GUESSES: [RegExp, BudgetCategory][] = [
  [/\b(lön|lon|salary|försäkringskassan)\b/, 'income'],
  [/(avanza|nordnet|sparkonto|\bisk\b)/, 'savings'],
  [/(hyra|\bbrf\b|\bhsb\b|hemförsäkring)/, 'housing'],
  [/(bolån|omsättning lån)/, 'mortgage'],
  [/(\bcsn\b|ränta|avgift lån|nordea bank\b)/, 'loans'],
  [/(telia|tele2|comviq|telenor|\btre\b|ellevio|vattenfall|e\.on|försäkring|if skade|folksam|trygg-hansa|akademike|a-kassa)/, 'bills'],
  [/(spotify|netflix|\bhbo\b|viaplay|disney|youtube|apple\.com|anthropic|claude)/, 'subscriptions'],
  // Revolut is his food/household card — topping it up is the grocery spend.
  [/(\bica\b|coop|willys|hemköp|lidl|city gross|mathem|\bspar\b|tempo|revolut)/, 'groceries'],
  [/(restaurang|brasserie|\bpub\b|liffey|mcdonald|\bmax\b|burger|pizz|sushi|foodora|wolt|espresso house|pressbyrån|7-eleven|cafe|café|\bbar\b)/, 'eating_out'],
  [/(\bsl\b|\bsj\b|ruter|a train|trafikkon|circle k|preem|okq8|\bingo\b|\bst1\b|uber|\bbolt\b|easypark|parkering|biltema|\bvy\b)/, 'transport'],
  [/(apotek|sats|nordic wellness|friskis|vårdcentral|tandläk)/, 'health'],
  [/(h&m|zalando|boozt|vinted|klarna|johnhenric|ikea|clas ohlson|elgiganten|amazon|systembolaget|åhléns|ahlens|stadium)/, 'shopping'],
]

/** Last category he chose for this merchant wins; otherwise a keyword guess. Money in is only ever income or a refund. */
export function guessCategory(description: string, amount: number, learned: Map<string, BudgetCategory>): BudgetCategory {
  const known = learned.get(merchantKey(description))
  if (known) return known
  const text = ` ${description.toLowerCase()} `
  for (const [re, category] of GUESSES) if (re.test(text) && (category !== 'income' || amount > 0)) return category
  return amount > 0 ? 'income' : 'other'
}

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"' && quoted && line[i + 1] === '"') {
      cur += '"'
      i++
    } else if (c === '"') quoted = !quoted
    else if (c === delimiter && !quoted) {
      out.push(cur.trim())
      cur = ''
    } else cur += c
  }
  out.push(cur.trim())
  return out
}

/** "-1 234,50", "-1.234,50", "1234.5" → number (NaN when it isn't one). */
export function parseAmount(raw: string): number {
  let s = raw.replace(/[\s ]|kr|SEK/g, '').replace('−', '-')
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  return s === '' ? NaN : Number(s)
}

const DATE_COLS = ['bokföringsdag', 'bokföringsdatum', 'datum', 'transaktionsdatum']
const AMOUNT_COLS = ['belopp']
const TEXT_COLS = ['rubrik', 'transaktion', 'text', 'beskrivning', 'namn']

/**
 * Parses a Nordea transaction export — the current netbank (`Bokföringsdag;Belopp;…;Namn;Rubrik`,
 * 2026/10/05, -123,50) and the older one (`Datum,Transaktion,…,Belopp`). Columns are found by
 * header name, so extra or reordered columns don't matter. Pending rows ("Reserverat") are skipped.
 */
export function parseNordeaCsv(text: string): { rows: ParsedRow[]; skipped: number } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
  if (!lines.length) throw new Error('The file is empty.')
  const delimiter = [';', '\t', ','].find((d) => lines[0].includes(d)) ?? ';'
  const header = splitLine(lines[0], delimiter).map((h) => h.toLowerCase())
  const col = (names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1
  const dateCol = col(DATE_COLS)
  const amountCol = col(AMOUNT_COLS)
  const textCols = TEXT_COLS.map((n) => header.indexOf(n)).filter((i) => i >= 0)
  if (dateCol < 0 || amountCol < 0) throw new Error("Couldn't find the date and amount columns — is this Nordea's transaction export?")

  const rows: ParsedRow[] = []
  const seen = new Map<string, number>()
  let skipped = 0
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, delimiter)
    const date = (cells[dateCol] ?? '').replace(/\//g, '-')
    const amount = parseAmount(cells[amountCol] ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount) || amount === 0) {
      skipped++
      continue
    }
    const description = textCols.map((i) => cells[i]).find((t) => t) ?? '(no text)'
    // ponytail: two identical rows on one day are told apart by order in the file; an export that
    // cuts a day in half could re-import one of them. Add the Saldo column to the key if that bites.
    const base = `${date}|${amount}|${description}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    rows.push({ date, amount, description, import_key: `${base}|${n}` })
  }
  return { rows, skipped }
}

/** Decodes the file as UTF-8, falling back to Windows-1252 (older Excel-saved exports). */
export function decodeCsv(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('windows-1252').decode(buffer)
  }
}

// --- Pay periods: the budget runs from one salary to the day before the next, not by calendar month.

const isSalary = (t: Pick<BankTransaction, 'description' | 'amount'>) => t.amount > 0 && /\b(lön|lon|salary)\b/i.test(t.description)

/** The day his salary landed in `month` ('yyyy-MM'), else the usual payday: the 22nd, or the 23rd when that's a Sunday. */
export function payday(month: string, transactions: Pick<BankTransaction, 'date' | 'description' | 'amount'>[]): string {
  const paid = transactions.filter((t) => t.date.startsWith(month) && isSalary(t)).map((t) => t.date).sort()[0]
  if (paid) return paid
  const [y, m] = month.split('-').map(Number)
  return `${month}-${new Date(Date.UTC(y, m - 1, 22)).getUTCDay() === 0 ? '23' : '22'}`
}

export const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Calendar month whose payday opens the period `date` falls in (before the 22nd → the month before). */
export const payMonthOf = (date: string) => (Number(date.slice(8, 10)) < 22 ? shiftMonth(date.slice(0, 7), -1) : date.slice(0, 7))

/** The period opened by `month`'s salary: [start, end] inclusive, yyyy-MM-dd. */
export function payPeriod(month: string, transactions: Pick<BankTransaction, 'date' | 'description' | 'amount'>[]): { start: string; end: string } {
  const next = payday(shiftMonth(month, 1), transactions)
  const end = new Date(next + 'T00:00:00Z')
  end.setUTCDate(end.getUTCDate() - 1)
  return { start: payday(month, transactions), end: end.toISOString().slice(0, 10) }
}

// --- Bank rows → the savings tab's accounts.

/** Set once in Budget (user_settings). Both are kr per month. */
export interface SplitRules {
  bufferPerMonth: number
  amortizationPerMonth: number
}

/**
 * What the bank rows saved, as savings-tab entries. Per pay period (`periodOf`) the first
 * `bufferPerMonth` into 'savings' is buffer and the rest ETF & stocks — his Avanza autogiros
 * share amounts (two of 2 500) so they can't be told apart row by row, only by total. Money
 * taken back out of savings comes off the buffer. Of each mortgage payment the first
 * `amortizationPerMonth` is loan paid; the rest is interest (a cost, not here).
 */
export function bankSavingsEntries(
  transactions: Pick<BankTransaction, 'date' | 'amount' | 'category'>[],
  rules: SplitRules,
  periodOf: (date: string) => string = payMonthOf,
): { date: string; account: SavingsAccount; amount: number }[] {
  const out: { date: string; account: SavingsAccount; amount: number }[] = []
  const bufferLeft = new Map<string, number>()
  for (const t of [...transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    const amount = -Number(t.amount) // money out of the bank account = saved
    if (t.category === 'mortgage') {
      const paid = Math.min(rules.amortizationPerMonth, Math.max(amount, 0))
      if (paid) out.push({ date: t.date, account: 'mortgage', amount: paid })
    } else if (t.category === 'savings') {
      const key = periodOf(t.date)
      const left = bufferLeft.get(key) ?? rules.bufferPerMonth
      const toBuffer = amount < 0 ? amount : Math.min(left, amount)
      bufferLeft.set(key, left - Math.max(toBuffer, 0))
      if (toBuffer) out.push({ date: t.date, account: 'buffer', amount: toBuffer })
      if (amount - toBuffer) out.push({ date: t.date, account: 'investments', amount: amount - toBuffer })
    }
  }
  return out
}

export interface PeriodBudget {
  income: number
  saved: number
  savedByAccount: Record<SavingsAccount, number>
  fixed: number
  variable: number
  /** Net Swished back for shared costs (positive = got more back than sent). */
  sharedBack: number
  left: number
  /** Net money out per fixed/variable category, largest first (a refund-heavy one can go negative). */
  byCategory: { category: BudgetCategory; amount: number }[]
}

/**
 * Totals for start..end (inclusive). Refunds net against their category; own transfers count
 * nowhere; a mortgage payment's amortization is saved and only its interest is a fixed cost.
 */
export function periodBudget(transactions: Pick<BankTransaction, 'date' | 'amount' | 'category'>[], start: string, end: string, rules: SplitRules): PeriodBudget {
  const inPeriod = transactions.filter((t) => t.date >= start && t.date <= end)
  const savedByAccount = { buffer: 0, mortgage: 0, investments: 0 }
  for (const e of bankSavingsEntries(inPeriod, rules, () => '')) savedByAccount[e.account] += e.amount
  let income = 0
  let sharedBack = 0
  const spend = new Map<BudgetCategory, number>()
  for (const t of inPeriod) {
    const group = CATEGORY_INFO[t.category]?.group ?? 'variable'
    if (group === 'ignored' || group === 'saved') continue
    const amount = Number(t.amount)
    const cost = t.category === 'mortgage' ? -amount - Math.min(rules.amortizationPerMonth, Math.max(-amount, 0)) : -amount
    if (group === 'income') income += amount
    else if (group === 'shared') sharedBack += amount
    else spend.set(t.category, (spend.get(t.category) ?? 0) + cost)
  }
  const byCategory = [...spend].map(([category, amount]) => ({ category, amount })).filter((c) => c.amount !== 0).sort((a, b) => b.amount - a.amount)
  const sum = (g: BudgetGroup) => byCategory.filter((c) => CATEGORY_INFO[c.category].group === g).reduce((s, c) => s + c.amount, 0)
  const fixed = sum('fixed')
  const variable = sum('variable')
  const saved = savedByAccount.buffer + savedByAccount.mortgage + savedByAccount.investments
  return { income, saved, savedByAccount, fixed, variable, sharedBack, left: income - saved - fixed - variable + sharedBack, byCategory }
}

// --- Plan: one monthly target per fixed/variable category (user_settings.budget_targets).

export type BudgetTargets = Partial<Record<BudgetCategory, number>>

/** Categories a target can be set for: what a pay period spends on. */
export const PLANNABLE = BUDGET_CATEGORIES.filter((c) => ['fixed', 'variable'].includes(CATEGORY_INFO[c].group))

export interface PlanRow {
  category: BudgetCategory
  actual: number
  /** Null = no target set; shown as before, without a plan. */
  target: number | null
}

/**
 * One row per fixed/variable category that has spending or a target, in picker order (fixed
 * first), so planned-but-untouched categories show as "0 / 5 000" instead of vanishing.
 * ponytail: one set of targets for every period — changing a target re-judges past periods
 * too. Store targets per period if he ever wants history of the plan itself.
 */
export function planRows(b: Pick<PeriodBudget, 'byCategory'>, targets: BudgetTargets): PlanRow[] {
  const actual = new Map(b.byCategory.map((c) => [c.category, c.amount]))
  return PLANNABLE.filter((c) => actual.has(c) || (targets[c] ?? 0) > 0).map((c) => ({ category: c, actual: actual.get(c) ?? 0, target: (targets[c] ?? 0) > 0 ? targets[c]! : null }))
}

/** Days left in start..end counting today, or null when today is outside it. */
export function daysLeft(today: string, end: string, start: string): number | null {
  if (today < start || today > end) return null
  return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000) + 1
}
