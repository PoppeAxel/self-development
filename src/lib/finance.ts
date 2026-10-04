// Journal → Finance: savings logged by hand (savings_entries). Pure — no supabase import —
// so scripts/finance.check.ts can run it under node.

export const SAVINGS_ACCOUNTS = ['buffer', 'mortgage', 'investments'] as const
export type SavingsAccount = (typeof SAVINGS_ACCOUNTS)[number]

export const ACCOUNT_INFO: Record<SavingsAccount, { label: string; icon: string; color: string }> = {
  buffer: { label: 'Buffer', icon: '🛟', color: '#2f6b5a' },
  mortgage: { label: 'House loan paid', icon: '🏠', color: '#46608f' },
  investments: { label: 'ETF & stocks', icon: '📈', color: '#a8842f' },
}

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
  const byAccount = { buffer: 0, mortgage: 0, investments: 0 }
  let withdrawn = 0
  for (const e of entries) {
    if (e.date < start || e.date > end) continue
    const amount = Number(e.amount)
    byAccount[e.account] += amount
    if (amount < 0) withdrawn -= amount
  }
  return { byAccount, withdrawn, net: byAccount.buffer + byAccount.mortgage + byAccount.investments }
}

// --- Pots: short-term saving for one thing (ring, watch, trip). Separate from the totals above.

export interface SavingsPot {
  id: string
  user_id: string
  name: string
  emoji: string | null
  target_amount: number
  target_date: string | null
  /** 'done' = bought. */
  status: 'active' | 'done'
  category_id: string | null
  /** Lower = higher priority. */
  rank: number
}

export interface PotCategory {
  id: string
  name: string
}

/**
 * Moving an item up/down swaps its rank with the neighbour in the list as shown (so it works
 * inside a category filter too). Null at either end. `shown` must be in rank order.
 */
export function swapNeighbour<T extends { id: string }>(shown: T[], id: string, dir: -1 | 1): T | null {
  const i = shown.findIndex((x) => x.id === id)
  return i < 0 ? null : (shown[i + dir] ?? null)
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
