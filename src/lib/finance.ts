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

export const formatKr = (n: number) => `${Math.round(n).toLocaleString('sv-SE')} kr`
