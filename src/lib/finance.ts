// Journal → Finance: savings logged by hand (savings_entries). Pure — no supabase import —
// so scripts/finance.check.ts can run it under node.

import { findOption, live } from './optionStore'
import type { OptionRow } from './editable'

// Savings accounts are `options` rows of kind 'savings_account' (migration 0049), edited in place
// in the Savings tab. `meta.buffer` accounts are filled, in order, from each pay period's bank
// savings; whatever's left over goes to 'investments'. 'investments' and 'mortgage' are system
// rows (budget.ts branches on those keys).

/** A savings_account key. */
export type SavingsAccount = string

export interface AccountInfo {
  key: SavingsAccount
  label: string
  icon: string
  color: string
  buffer: boolean
}

const toAccount = (r: OptionRow): AccountInfo => ({ key: r.key, label: r.label, icon: r.icon ?? '🏦', color: r.color ?? '#8b8577', buffer: r.meta.buffer === true })

/** Live accounts, in order. */
export const savingsAccounts = (): AccountInfo[] => live('savings_account').map(toAccount)

/** The buffers bank savings fill, in fill order. */
export const bufferAccounts = (): SavingsAccount[] => savingsAccounts().filter((a) => a.buffer).map((a) => a.key)

/** Any account by key (archived too, so old entries keep their name); an unknown key reads as itself. */
export const accountInfo = (key: SavingsAccount): AccountInfo => {
  const r = findOption('savings_account', key)
  return r ? toAccount(r) : { key, label: key, icon: '🏦', color: '#8b8577', buffer: false }
}

/** 0 for every live account, so each shows even with nothing logged; other keys are added as they turn up. */
export const zeroAccounts = (): Record<SavingsAccount, number> => Object.fromEntries(savingsAccounts().map((a) => [a.key, 0]))

export interface SavingsEntry {
  id: string
  user_id: string
  date: string
  account: SavingsAccount
  /** Negative = a withdrawal from that account. */
  amount: number
  note: string | null
}

export interface PeriodTotals {
  /** Net per account (deposits minus withdrawals). */
  byAccount: Record<SavingsAccount, number>
  withdrawn: number
  net: number
}

/** Totals for entries dated from `start` to `end`, both inclusive (yyyy-MM-dd). */
export function periodTotals(entries: Pick<SavingsEntry, 'date' | 'account' | 'amount'>[], start: string, end: string): PeriodTotals {
  const byAccount = zeroAccounts()
  let withdrawn = 0
  for (const e of entries) {
    if (e.date < start || e.date > end) continue
    const amount = Number(e.amount)
    byAccount[e.account] = (byAccount[e.account] ?? 0) + amount
    if (amount < 0) withdrawn -= amount
  }
  return { byAccount, withdrawn, net: Object.values(byAccount).reduce((s, v) => s + v, 0) }
}

// --- Pots: short-term saving for one thing (ring, watch, trip). Separate from the totals above.

export interface SavingsPot {
  id: string
  user_id: string
  name: string
  emoji: string | null
  target_amount: number
  target_date: string | null
  status: 'active' | 'done'
}

export interface PotEntry {
  id: string
  pot_id: string
  date: string
  /** Negative = taken out of the pot. */
  amount: number
  note: string | null
}

export interface PotProgress {
  saved: number
  remaining: number
  /** Months left to the target date, counting the current one. Null without a date. */
  monthsLeft: number | null
  /** What to put in each remaining month to make the date. Null without a date or when reached. */
  perMonth: number | null
}

export function potProgress(pot: Pick<SavingsPot, 'id' | 'target_amount' | 'target_date'>, entries: Pick<PotEntry, 'pot_id' | 'amount'>[], today: string): PotProgress {
  const saved = entries.filter((e) => e.pot_id === pot.id).reduce((s, e) => s + Number(e.amount), 0)
  const remaining = Math.max(0, Number(pot.target_amount) - saved)
  if (!pot.target_date) return { saved, remaining, monthsLeft: null, perMonth: null }
  const [ty, tm] = pot.target_date.split('-').map(Number)
  const [y, m] = today.split('-').map(Number)
  // A date this month (or already past) leaves one month: the whole remainder is due now.
  const monthsLeft = Math.max(1, (ty - y) * 12 + (tm - m) + 1)
  return { saved, remaining, monthsLeft, perMonth: remaining > 0 ? Math.ceil(remaining / monthsLeft) : null }
}

export const formatKr =(n: number) => `${Math.round(n).toLocaleString('sv-SE')} kr`
