// Economy → Budget: Nordea CSV export → bank_transactions. Pure — no supabase import —
// so scripts/budget.check.ts can run it under node.

import { BUFFER_ACCOUNTS, SAVINGS_ACCOUNTS, type BufferAccount, type SavingsAccount } from './finance'

// Head categories → subcategories. A transaction stores its SUBcategory id; heads only group
// them on screen. Each subcategory is fixed or variable on its own, so a head can hold both
// (Home: the housing fee is fixed, furnishing is variable). Fixed list on purpose — he asks
// for changes rather than maintaining categories in the app.
export const HEADS = [
  { id: 'home', label: 'Home', icon: '🏠', color: '#8a5a44', subs: ['housing', 'mortgage', 'electricity', 'home_insurance', 'household'] },
  { id: 'food', label: 'Food', icon: '🛒', color: '#3f9a6b', subs: ['groceries', 'eating_out'] },
  { id: 'transport', label: 'Transport', icon: '🚗', color: '#4f7f8c', subs: ['car_costs', 'fuel_parking', 'public_transport'] },
  { id: 'bills', label: 'Bills & subscriptions', icon: '📱', color: '#7a6aa8', subs: ['phone', 'streaming', 'union'] },
  { id: 'loans', label: 'Loans', icon: '🎓', color: '#6b5a8a', subs: ['csn', 'other_loans'] },
  { id: 'shopping', label: 'Shopping', icon: '🛍️', color: '#a8842f', subs: ['clothes', 'shopping'] },
  { id: 'health', label: 'Health & training', icon: '💪', color: '#b45a6e', subs: ['gym', 'pharmacy_care'] },
  { id: 'fun', label: 'Fun & travel', icon: '🎉', color: '#c0703a', subs: ['going_out', 'trips'] },
  { id: 'other', label: 'Other', icon: '📦', color: '#8c8577', subs: ['other'] },
] as const
export type HeadId = (typeof HEADS)[number]['id']
export type SubCategory = (typeof HEADS)[number]['subs'][number]

const SUB_INFO: Record<SubCategory, { label: string; group: 'fixed' | 'variable' }> = {
  housing: { label: 'Housing fee', group: 'fixed' },
  // The payment row; its amortization part counts as saved, only the interest as a cost.
  mortgage: { label: 'Mortgage interest', group: 'fixed' },
  electricity: { label: 'Electricity', group: 'fixed' },
  home_insurance: { label: 'Home insurance', group: 'fixed' },
  household: { label: 'Furnishing & household', group: 'variable' },
  groceries: { label: 'Groceries', group: 'variable' },
  eating_out: { label: 'Eating out', group: 'variable' },
  car_costs: { label: 'Car costs', group: 'fixed' },
  fuel_parking: { label: 'Fuel & parking', group: 'variable' },
  public_transport: { label: 'Public transport', group: 'variable' },
  phone: { label: 'Phone', group: 'fixed' },
  streaming: { label: 'Streaming & apps', group: 'fixed' },
  union: { label: 'Union & a-kassa', group: 'fixed' },
  csn: { label: 'CSN', group: 'fixed' },
  other_loans: { label: 'Other loans', group: 'fixed' },
  clothes: { label: 'Clothes', group: 'variable' },
  shopping: { label: 'Other shopping', group: 'variable' },
  gym: { label: 'Gym', group: 'fixed' },
  pharmacy_care: { label: 'Pharmacy & care', group: 'variable' },
  going_out: { label: 'Going out', group: 'variable' },
  trips: { label: 'Trips', group: 'variable' },
  other: { label: 'Other', group: 'variable' },
}

const SPECIAL = ['income', 'savings', 'card', 'shared', 'transfer'] as const
export type BudgetCategory = (typeof SPECIAL)[number] | SubCategory
export type BudgetGroup = 'income' | 'saved' | 'card' | 'fixed' | 'variable' | 'shared' | 'ignored'

/** Every category, in picker order: income, savings, card, then each head's subs, shared, transfer. */
export const BUDGET_CATEGORIES: BudgetCategory[] = ['income', 'savings', 'card', ...HEADS.flatMap((h) => h.subs), 'shared', 'transfer']

export const GROUP_LABEL: Record<BudgetGroup, string> = {
  income: 'Income',
  saved: 'Saved',
  card: 'Spending card',
  fixed: 'Fixed costs',
  variable: 'Variable',
  shared: 'Shared',
  ignored: 'Ignored',
}

export interface CategoryInfo {
  label: string
  icon: string
  color: string
  group: BudgetGroup
  /** Set for subcategories only. */
  head?: HeadId
}

export const CATEGORY_INFO = {
  income: { label: 'Income', icon: '💰', color: '#2f6b5a', group: 'income' },
  // Split by SplitRules into the buffers and ETF & stocks (see bankSavingsEntries).
  savings: { label: 'Savings (Avanza)', icon: '🏦', color: '#46608f', group: 'saved' },
  // Swish to/from his partner for split costs. Her share covers rent as well as food, so it
  // nets against the total (left over), not against any one head.
  shared: { label: 'Shared costs', icon: '🤝', color: '#9a7b5f', group: 'shared' },
  // Moves between his own accounts: counted nowhere.
  transfer: { label: 'Own transfer (ignored)', icon: '↔️', color: '#b9b2a4', group: 'ignored' },
  // Top-ups of his Revolut card, which he spends on food, fuel and odds and ends. Split by
  // SplitRules.card into subcategories (see periodBudget) — the purchases themselves never
  // reach this account.
  card: { label: 'Revolut card (split)', icon: '💳', color: '#5b7fa6', group: 'card' },
  ...Object.fromEntries(HEADS.flatMap((h) => h.subs.map((s) => [s, { ...SUB_INFO[s], icon: h.icon, color: h.color, head: h.id }]))),
} as Record<BudgetCategory, CategoryInfo>

/** Info for a stored category; anything unknown (an id from before a rename) reads as Other. */
export const categoryInfo = (c: string): CategoryInfo => CATEGORY_INFO[c as BudgetCategory] ?? CATEGORY_INFO.other
export const headOf = (id: HeadId) => HEADS.find((h) => h.id === id)!

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
  [/(hyra|\bbrf\b|\bhsb\b)/, 'housing'],
  [/(bolån|omsättning lån)/, 'mortgage'],
  [/(ellevio|vattenfall|e\.on|tibber|fortum)/, 'electricity'],
  [/(hemförsäkring|if skade|folksam|trygg-hansa|länsförsäkringar)/, 'home_insurance'],
  [/(ikea|clas ohlson|jula|bauhaus|hornbach|byggmax|mio\b|rusta)/, 'household'],
  [/(\bcsn\b)/, 'csn'],
  [/(ränta|avgift lån|nordea bank\b)/, 'other_loans'],
  [/(telia|tele2|comviq|telenor|\btre\b|hallon)/, 'phone'],
  [/(spotify|netflix|\bhbo\b|viaplay|disney|youtube|apple\.com|anthropic|claude|microsoft)/, 'streaming'],
  [/(akademike|a-kassa|unionen|\bsaco\b)/, 'union'],
  // Revolut is his food/household card — topping it up is the grocery spend.
  [/(revolut)/, 'card'],
  [/(\bica\b|coop|willys|hemköp|lidl|city gross|mathem|\bspar\b|tempo)/, 'groceries'],
  [/(\bbar\b|\bpub\b|liffey|nattklubb|tickster|ticketmaster|filmstaden|biljett)/, 'going_out'],
  [/(restaurang|brasserie|mcdonald|\bmax\b|burger|pizz|sushi|foodora|wolt|espresso house|pressbyrån|7-eleven|cafe|café)/, 'eating_out'],
  [/(transportstyrelsen|fordonsskatt|bilförsäkring|besiktning|bilprovning|däck)/, 'car_costs'],
  [/(circle k|preem|okq8|\bingo\b|\bst1\b|easypark|parkering|trafikkon|biltema)/, 'fuel_parking'],
  [/(\bsl\b|\bsj\b|ruter|a train|\bvy\b|uber|\bbolt\b|västtrafik|skånetrafiken)/, 'public_transport'],
  [/(\bsas\b|norwegian|ryanair|booking\.com|airbnb|hotel|hotell)/, 'trips'],
  [/(sats|nordic wellness|friskis|actic)/, 'gym'],
  [/(apotek|vårdcentral|tandläk|\bkry\b|1177)/, 'pharmacy_care'],
  [/(h&m|zalando|boozt|vinted|johnhenric|stadium|dressmann|weekday|carlings)/, 'clothes'],
  [/(klarna|elgiganten|amazon|systembolaget|åhléns|ahlens|webhallen|inet)/, 'shopping'],
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

/** Set once in Budget (user_settings). All kr per month. */
export interface SplitRules {
  /** How much of each pay period's savings goes to each buffer, filled in BUFFER_ACCOUNTS order. */
  buffers: Record<BufferAccount, number>
  amortizationPerMonth: number
  /** How each pay period's card top-ups are spent, filled in CARD_SUBS order; the rest is Other. */
  card: Partial<Record<SubCategory, number>>
}

/** Subcategories a card top-up can be split into, in fill order. */
export const CARD_SUBS = ['groceries', 'fuel_parking', 'shopping', 'eating_out'] as const satisfies readonly SubCategory[]

export const NO_RULES: SplitRules = { buffers: { buffer: 0, car_buffer: 0, travel_buffer: 0 }, amortizationPerMonth: 0, card: {} }

/**
 * What the bank rows saved, as savings-tab entries. Per pay period (`periodOf`) money into
 * 'savings' fills each buffer up to its monthly amount (buffer, then car, then travel) and the
 * rest is ETF & stocks — his Avanza autogiros share amounts (two of 2 500) so they can't be
 * told apart row by row, only by total. Money taken back out of savings comes off the main
 * buffer. Of each mortgage payment the first `amortizationPerMonth` is loan paid; the rest
 * is interest (a cost, not here).
 */
export function bankSavingsEntries(
  transactions: Pick<BankTransaction, 'date' | 'amount' | 'category'>[],
  rules: SplitRules,
  periodOf: (date: string) => string = payMonthOf,
): { date: string; account: SavingsAccount; amount: number }[] {
  const out: { date: string; account: SavingsAccount; amount: number }[] = []
  // Per period, what each buffer can still take this period.
  const room = new Map<string, Record<BufferAccount, number>>()
  for (const t of [...transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    const amount = -Number(t.amount) // money out of the bank account = saved
    if (t.category === 'mortgage') {
      const paid = Math.min(rules.amortizationPerMonth, Math.max(amount, 0))
      if (paid) out.push({ date: t.date, account: 'mortgage', amount: paid })
    } else if (t.category === 'savings') {
      if (amount < 0) {
        out.push({ date: t.date, account: 'buffer', amount })
        continue
      }
      const key = periodOf(t.date)
      const left = room.get(key) ?? { ...rules.buffers }
      room.set(key, left)
      let rest = amount
      for (const b of BUFFER_ACCOUNTS) {
        const take = Math.min(left[b], rest)
        if (take <= 0) continue
        left[b] -= take
        rest -= take
        out.push({ date: t.date, account: b, amount: take })
      }
      if (rest) out.push({ date: t.date, account: 'investments', amount: rest })
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
 * A period's net card top-ups split into subcategories: each CARD_SUBS entry up to its amount
 * in order, the rest Other. Money back from the card (net negative) reads as Other too.
 */
export function splitCard(topUps: number, split: SplitRules['card']): { category: SubCategory; amount: number }[] {
  const out: { category: SubCategory; amount: number }[] = []
  let rest = topUps
  for (const c of CARD_SUBS) {
    const take = Math.min(split[c] ?? 0, Math.max(rest, 0))
    if (take <= 0) continue
    out.push({ category: c, amount: take })
    rest -= take
  }
  if (rest) out.push({ category: 'other', amount: rest })
  return out
}

/**
 * Totals for start..end (inclusive). Refunds net against their category; own transfers count
 * nowhere; a mortgage payment's amortization is saved and only its interest is a fixed cost;
 * card top-ups are spread over their subcategories by `rules.card`.
 */
export function periodBudget(transactions: Pick<BankTransaction, 'date' | 'amount' | 'category'>[], start: string, end: string, rules: SplitRules): PeriodBudget {
  const inPeriod = transactions.filter((t) => t.date >= start && t.date <= end)
  const savedByAccount = Object.fromEntries(SAVINGS_ACCOUNTS.map((a) => [a, 0])) as Record<SavingsAccount, number>
  for (const e of bankSavingsEntries(inPeriod, rules, () => '')) savedByAccount[e.account] += e.amount
  let income = 0
  let sharedBack = 0
  let topUps = 0
  const spend = new Map<BudgetCategory, number>()
  const addSpend = (c: BudgetCategory, cost: number) => spend.set(c, (spend.get(c) ?? 0) + cost)
  for (const t of inPeriod) {
    // An id that no longer exists (renamed category) counts as Other rather than vanishing.
    const category = t.category in CATEGORY_INFO ? t.category : 'other'
    const group = CATEGORY_INFO[category].group
    if (group === 'ignored' || group === 'saved') continue
    const amount = Number(t.amount)
    const cost = category === 'mortgage' ? -amount - Math.min(rules.amortizationPerMonth, Math.max(-amount, 0)) : -amount
    if (group === 'income') income += amount
    else if (group === 'shared') sharedBack += amount
    else if (group === 'card') topUps += cost
    else addSpend(category, cost)
  }
  for (const s of splitCard(topUps, rules.card)) addSpend(s.category, s.amount)
  const byCategory = [...spend].map(([category, amount]) => ({ category, amount })).filter((c) => c.amount !== 0).sort((a, b) => b.amount - a.amount)
  const sum = (g: BudgetGroup) => byCategory.filter((c) => CATEGORY_INFO[c.category].group === g).reduce((s, c) => s + c.amount, 0)
  const fixed = sum('fixed')
  const variable = sum('variable')
  const saved = SAVINGS_ACCOUNTS.reduce((s, a) => s + savedByAccount[a], 0)
  return { income, saved, savedByAccount, fixed, variable, sharedBack, left: income - saved - fixed - variable + sharedBack, byCategory }
}

// --- Plan: one monthly target per fixed/variable category (user_settings.budget_targets).

export type BudgetTargets = Partial<Record<BudgetCategory, number>>

/** Categories a target can be set for: what a pay period spends on. */
export const PLANNABLE: BudgetCategory[] = HEADS.flatMap((h) => h.subs)

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

export interface HeadRow {
  head: HeadId
  actual: number
  /** Sum of its subcategories' targets; null when none of them has one. */
  target: number | null
  subs: PlanRow[]
}

/** Plan rows rolled up into their head categories, in HEADS order (heads with nothing to show are left out). */
export function headRows(rows: PlanRow[]): HeadRow[] {
  return HEADS.map((h) => {
    const subs = rows.filter((r) => CATEGORY_INFO[r.category].head === h.id)
    const targets = subs.filter((r) => r.target != null)
    return {
      head: h.id,
      actual: subs.reduce((s, r) => s + r.actual, 0),
      target: targets.length ? targets.reduce((s, r) => s + r.target!, 0) : null,
      subs,
    }
  }).filter((h) => h.subs.length)
}

/** Days left in start..end counting today, or null when today is outside it. */
export function daysLeft(today: string, end: string, start: string): number | null {
  if (today < start || today > end) return null
  return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000) + 1
}
