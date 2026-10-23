// Finance → Budget: Nordea CSV export → bank_transactions. Pure — no supabase import —
// so scripts/budget.check.ts can run it under node.

export const BUDGET_CATEGORIES = ['income', 'savings', 'housing', 'groceries', 'eating_out', 'transport', 'shopping', 'bills', 'health', 'other', 'transfer'] as const
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number]

export const CATEGORY_INFO: Record<BudgetCategory, { label: string; icon: string; color: string }> = {
  income: { label: 'Income', icon: '💰', color: '#2f6b5a' },
  savings: { label: 'Savings', icon: '🏦', color: '#46608f' },
  housing: { label: 'Housing', icon: '🏠', color: '#8a5a44' },
  groceries: { label: 'Groceries', icon: '🛒', color: '#3f9a6b' },
  eating_out: { label: 'Eating out', icon: '🍔', color: '#c0703a' },
  transport: { label: 'Transport', icon: '🚗', color: '#5b7fa6' },
  shopping: { label: 'Shopping', icon: '🛍️', color: '#a8842f' },
  bills: { label: 'Bills & subscriptions', icon: '📱', color: '#7a6aa8' },
  health: { label: 'Health & training', icon: '💪', color: '#b45a6e' },
  other: { label: 'Other', icon: '📦', color: '#8c8577' },
  // Moves between his own accounts: counted nowhere.
  transfer: { label: 'Own transfer (ignored)', icon: '↔️', color: '#b9b2a4' },
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
  [/\b(lön|lon|salary|försäkringskassan|csn)\b/, 'income'],
  [/(avanza|nordnet|sparkonto|\bisk\b)/, 'savings'],
  [/(hyra|\bbrf\b|bolån|ränta|avgift lån|hemförsäkring)/, 'housing'],
  [/(\bica\b|coop|willys|hemköp|lidl|city gross|mathem|\bspar\b|tempo)/, 'groceries'],
  [/(restaurang|mcdonald|\bmax\b|burger|pizz|sushi|foodora|wolt|espresso house|pressbyrån|7-eleven|cafe|café|\bbar\b)/, 'eating_out'],
  [/(\bsl\b|\bsj\b|circle k|preem|okq8|\bingo\b|\bst1\b|uber|\bbolt\b|easypark|parkering|biltema|\bvy\b)/, 'transport'],
  [/(spotify|netflix|\bhbo\b|viaplay|disney|youtube|apple\.com|telia|tele2|comviq|telenor|\btre\b|ellevio|vattenfall|e\.on|försäkring|if skade|folksam|trygg-hansa)/, 'bills'],
  [/(apotek|sats|nordic wellness|friskis|vårdcentral|tandläk)/, 'health'],
  [/(h&m|zalando|ikea|clas ohlson|elgiganten|amazon|systembolaget|åhléns|stadium)/, 'shopping'],
]

/** Last category he chose for this merchant wins; otherwise a keyword guess. */
export function guessCategory(description: string, amount: number, learned: Map<string, BudgetCategory>): BudgetCategory {
  const known = learned.get(merchantKey(description))
  if (known) return known
  const text = ` ${description.toLowerCase()} `
  for (const [re, category] of GUESSES) if (re.test(text)) return category
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

export interface MonthBudget {
  income: number
  saved: number
  spent: number
  left: number
  /** Money out per spending category (positive), largest first. */
  byCategory: { category: BudgetCategory; amount: number }[]
}

/** `month` = 'yyyy-MM'. Refunds net against their category; own transfers count nowhere. */
export function monthBudget(transactions: Pick<BankTransaction, 'date' | 'amount' | 'category'>[], month: string): MonthBudget {
  let income = 0
  let saved = 0
  const spend = new Map<BudgetCategory, number>()
  for (const t of transactions) {
    if (!t.date.startsWith(month) || t.category === 'transfer') continue
    const amount = Number(t.amount)
    if (t.category === 'income') income += amount
    else if (t.category === 'savings') saved -= amount
    else spend.set(t.category, (spend.get(t.category) ?? 0) - amount)
  }
  const byCategory = [...spend].map(([category, amount]) => ({ category, amount })).filter((c) => c.amount !== 0).sort((a, b) => b.amount - a.amount)
  const spent = byCategory.reduce((s, c) => s + c.amount, 0)
  return { income, saved, spent, left: income - saved - spent, byCategory }
}
