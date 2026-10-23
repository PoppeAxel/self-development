import { supabase } from './supabase'
import { bankSavingsEntries, NO_RULES, shiftMonth, type SplitRules } from './budget'
import { BUFFER_ACCOUNTS } from './finance'

// Savings implied by imported bank rows (Avanza autogiros, mortgage amortization), shaped like
// savings_entries so the Finance savings tab and 'savings' goals add them to what's logged by hand.

export async function loadBudgetRules(): Promise<SplitRules> {
  const { data } = await supabase.from('user_settings').select('budget_savings_split, mortgage_amortization_per_month, budget_card_split').maybeSingle()
  const split = (data?.budget_savings_split ?? {}) as Record<string, number>
  return {
    buffers: Object.fromEntries(BUFFER_ACCOUNTS.map((b) => [b, Number(split[b] ?? 0)])) as SplitRules['buffers'],
    amortizationPerMonth: Number(data?.mortgage_amortization_per_month ?? NO_RULES.amortizationPerMonth),
    card: (data?.budget_card_split ?? {}) as SplitRules['card'],
  }
}

/** Bank-derived savings dated start..end (inclusive). */
export async function loadBankSavings(start: string, end: string) {
  // From a month earlier, so a pay period that began before `start` has used its buffer share.
  const from = `${shiftMonth(start.slice(0, 7), -1)}-01`
  const [rules, { data }] = await Promise.all([
    loadBudgetRules(),
    supabase.from('bank_transactions').select('date, amount, category').in('category', ['savings', 'mortgage']).gte('date', from).lte('date', end),
  ])
  // One row per day and account — seven autogiros on payday read as "Buffer 4 000, ETF 6 000".
  const merged = new Map<string, ReturnType<typeof bankSavingsEntries>[number]>()
  for (const e of bankSavingsEntries((data ?? []) as Parameters<typeof bankSavingsEntries>[0], rules)) {
    if (e.date < start || e.date > end) continue
    const key = `${e.date}|${e.account}`
    const prev = merged.get(key)
    merged.set(key, prev ? { ...prev, amount: prev.amount + e.amount } : e)
  }
  return [...merged.values()]
}
