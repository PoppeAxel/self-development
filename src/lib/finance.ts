import { supabase } from './supabase'
import type { Portfolio, PortfolioEntry } from './types'

export async function getPortfolios(): Promise<Portfolio[]> {
  const { data, error } = await supabase.from('portfolios').select('*').order('position')
  if (error) throw error
  return (data ?? []) as Portfolio[]
}

export async function addPortfolio(name: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  const portfolios = await getPortfolios()
  const position = portfolios.length ? Math.max(...portfolios.map((p) => p.position)) + 1 : 0
  const { error } = await supabase.from('portfolios').insert({ name: name.trim(), position, user_id: user.id })
  if (error) throw error
}

export async function renamePortfolio(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('portfolios').update({ name: name.trim() }).eq('id', id)
  if (error) throw error
}

export async function deletePortfolio(id: string): Promise<void> {
  const { error } = await supabase.from('portfolios').delete().eq('id', id)
  if (error) throw error
}

export async function getEntries(): Promise<PortfolioEntry[]> {
  const { data, error } = await supabase.from('portfolio_entries').select('*').order('date')
  if (error) throw error
  return (data ?? []) as PortfolioEntry[]
}

// Saves one week's snapshot across every portfolio at once — the normal workflow, see
// Finance.tsx's log form. `portfolio_id, date` is a real (non-partial) unique constraint,
// so a plain upsert works here (see CONTEXT.md's note on partial-unique-index upserts).
export async function saveWeekEntries(
  date: string,
  rows: { portfolio_id: string; total_value: number; contribution: number }[],
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  const { error } = await supabase
    .from('portfolio_entries')
    .upsert(
      rows.map((r) => ({ ...r, date, user_id: user.id })),
      { onConflict: 'portfolio_id,date' },
    )
  if (error) throw error
}

export async function deleteWeekEntries(date: string): Promise<void> {
  const { error } = await supabase.from('portfolio_entries').delete().eq('date', date)
  if (error) throw error
}

export interface WeekTotal {
  date: string
  total: number
  contribution: number
}

// Groups every portfolio's entries by date into a combined total — the normal case since
// all portfolios get logged together once a week.
export function weekTotals(entries: PortfolioEntry[]): WeekTotal[] {
  const byDate = new Map<string, WeekTotal>()
  for (const e of entries) {
    const row = byDate.get(e.date) ?? { date: e.date, total: 0, contribution: 0 }
    row.total += e.total_value
    row.contribution += e.contribution
    byDate.set(e.date, row)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export interface WeeklyChange {
  date: string
  change: number
  changePct: number | null
}

// Value change since the previous logged week, excluding that week's own deposits/
// withdrawals — i.e. actual market movement, not money added or removed.
export function latestChange(totals: WeekTotal[]): WeeklyChange | null {
  if (totals.length < 2) return null
  const latest = totals[totals.length - 1]
  const previous = totals[totals.length - 2]
  const change = latest.total - previous.total - latest.contribution
  const changePct = previous.total !== 0 ? change / previous.total : null
  return { date: latest.date, change, changePct }
}

export function totalContributions(entries: PortfolioEntry[]): number {
  return entries.reduce((sum, e) => sum + e.contribution, 0)
}

// Chart-ready rows: one column per portfolio (by name) plus a running "total" column.
// Assumes portfolios are normally logged together (a portfolio missing on a given date
// just leaves a gap in its own line).
export function chartData(portfolios: Portfolio[], entries: PortfolioEntry[]): Record<string, number | string>[] {
  const dates = [...new Set(entries.map((e) => e.date))].sort()
  return dates.map((date) => {
    const row: Record<string, number | string> = { date }
    let total = 0
    for (const p of portfolios) {
      const e = entries.find((en) => en.portfolio_id === p.id && en.date === date)
      if (e) {
        row[p.name] = e.total_value
        total += e.total_value
      }
    }
    row.total = total
    return row
  })
}

export interface PortfolioLatest {
  portfolio: Portfolio
  latest: PortfolioEntry | null
  change: number | null
  changePct: number | null
}

export function portfolioLatests(portfolios: Portfolio[], entries: PortfolioEntry[]): PortfolioLatest[] {
  return portfolios.map((p) => {
    const own = entries.filter((e) => e.portfolio_id === p.id).sort((a, b) => a.date.localeCompare(b.date))
    const latest = own[own.length - 1] ?? null
    const previous = own[own.length - 2] ?? null
    let change: number | null = null
    let changePct: number | null = null
    if (latest && previous) {
      change = latest.total_value - previous.total_value - latest.contribution
      changePct = previous.total_value !== 0 ? change / previous.total_value : null
    }
    return { portfolio: p, latest, change, changePct }
  })
}
