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

// --- Deposits vs growth ---
// The account grows two ways: money put in, and the market. Splitting them is the whole
// point of logging contributions, but until now nothing showed them apart over time.

export interface TotalWithDeposits {
  date: string
  total: number
  /** Everything paid in up to and including this date. */
  deposited: number
}

/** One row per logged date: the total value, with cumulative deposits underneath it. */
export function totalsWithDeposits(entries: PortfolioEntry[]): TotalWithDeposits[] {
  let deposited = 0
  return weekTotals(entries).map((row) => {
    deposited += row.contribution
    return { date: row.date, total: row.total, deposited }
  })
}

/**
 * Where the account lands at the end of the year if the last stretch repeats — deliberately
 * "at this pace", including deposits, since that's the pace the account actually moves at.
 * Null until there are enough weeks for an average to mean anything.
 */
export function yearEndProjection(totals: WeekTotal[], window = 8, minWeeks = 3): { date: string; value: number } | null {
  if (totals.length < minWeeks) return null
  const recent = totals.slice(-window)
  const span = recent.length - 1
  if (span < 1) return null
  const perWeek = (recent[recent.length - 1].total - recent[0].total) / span

  const latest = recent[recent.length - 1]
  const latestDate = new Date(latest.date + 'T00:00:00')
  const yearEnd = new Date(latestDate.getFullYear(), 11, 31)
  const weeksLeft = (yearEnd.getTime() - latestDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
  if (weeksLeft <= 0) return null

  return { date: `${latestDate.getFullYear()}-12-31`, value: latest.total + perWeek * weeksLeft }
}

/** True when the current Mon–Sun week has no entry yet — what the log nudge keys off. */
export function weeklyLogDue(entries: PortfolioEntry[], weekStart: string): boolean {
  return !entries.some((e) => e.date >= weekStart)
}
