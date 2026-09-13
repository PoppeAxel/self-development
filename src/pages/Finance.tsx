import { useEffect, useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'
import { todayISO } from '../lib/dates'
import { Screen } from '../components/Screen'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  addPortfolio,
  chartData,
  deletePortfolio,
  deleteWeekEntries,
  getEntries,
  getPortfolios,
  latestChange,
  portfolioLatests,
  renamePortfolio,
  saveWeekEntries,
  totalContributions,
  weekTotals,
} from '../lib/finance'
import type { Portfolio, PortfolioEntry } from '../lib/types'

const LINE_COLORS = ['#0284c7', '#7c3aed', '#d97706', '#059669', '#e11d48']

function formatKr(n: number): string {
  return `${Math.round(n).toLocaleString('sv-SE')} kr`
}

function formatSigned(n: number): string {
  const s = Math.round(n).toLocaleString('sv-SE')
  return n > 0 ? `+${s} kr` : `${s} kr`
}

function formatPct(n: number | null): string {
  if (n == null) return '—'
  const pct = (n * 100).toFixed(1)
  return n > 0 ? `+${pct}%` : `${pct}%`
}

export function Finance() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [entries, setEntries] = useState<PortfolioEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [logDate, setLogDate] = useState(todayISO())
  const [values, setValues] = useState<Record<string, string>>({})
  const [contributions, setContributions] = useState<Record<string, string>>({})
  const [newPortfolioName, setNewPortfolioName] = useState('')
  const [managingPortfolios, setManagingPortfolios] = useState(false)
  const [confirmDeleteDate, setConfirmDeleteDate] = useState<string | null>(null)
  const [confirmDeletePortfolio, setConfirmDeletePortfolio] = useState<Portfolio | null>(null)

  async function load() {
    setLoading(true)
    const [p, e] = await Promise.all([getPortfolios(), getEntries()])
    setPortfolios(p)
    setEntries(e)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  // Prefill the log form: if `logDate` already has entries, edit those; otherwise start
  // from each portfolio's most recent known value (contribution defaults to 0) so the
  // user only has to tweak a number instead of retyping the whole value.
  useEffect(() => {
    const nextValues: Record<string, string> = {}
    const nextContributions: Record<string, string> = {}
    for (const p of portfolios) {
      const own = entries.filter((e) => e.portfolio_id === p.id).sort((a, b) => a.date.localeCompare(b.date))
      const onDate = own.find((e) => e.date === logDate)
      if (onDate) {
        nextValues[p.id] = String(onDate.total_value)
        nextContributions[p.id] = String(onDate.contribution)
      } else {
        const priorOnly = own.filter((e) => e.date < logDate)
        const mostRecent = priorOnly[priorOnly.length - 1]
        nextValues[p.id] = mostRecent ? String(mostRecent.total_value) : ''
        nextContributions[p.id] = '0'
      }
    }
    setValues(nextValues)
    setContributions(nextContributions)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logDate, portfolios, entries])

  const totals = useMemo(() => weekTotals(entries), [entries])
  const change = useMemo(() => latestChange(totals), [totals])
  const currentTotal = totals[totals.length - 1]?.total ?? 0
  const contributedTotal = useMemo(() => totalContributions(entries), [entries])
  const growth = currentTotal - contributedTotal
  const growthPct = contributedTotal !== 0 ? growth / contributedTotal : null
  const latests = useMemo(() => portfolioLatests(portfolios, entries), [portfolios, entries])
  const chart = useMemo(() => chartData(portfolios, entries), [portfolios, entries])
  const history = [...totals].reverse()

  async function submitWeek(e: React.FormEvent) {
    e.preventDefault()
    const rows = portfolios
      .filter((p) => values[p.id]?.trim())
      .map((p) => ({
        portfolio_id: p.id,
        total_value: Number(values[p.id]),
        contribution: Number(contributions[p.id] || 0),
      }))
    if (!rows.length) return
    await saveWeekEntries(logDate, rows)
    await load()
  }

  async function submitNewPortfolio(e: React.FormEvent) {
    e.preventDefault()
    if (!newPortfolioName.trim()) return
    await addPortfolio(newPortfolioName)
    setNewPortfolioName('')
    await load()
  }

  return (
    <Screen title="Finance" onRefresh={load}>

      {loading ? (
        <p className="text-sm text-ink-disabled">Loading…</p>
      ) : portfolios.length === 0 ? (
        <div className="rounded-3xl border border-line bg-surface p-4 shadow-card">
          <p className="text-sm text-ink-3">No portfolios yet — add your first one below.</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="rounded-3xl border border-line bg-surface p-4 shadow-card">
            <p className="text-xs font-medium text-ink-disabled">Total value</p>
            <p className="text-3xl font-bold text-ink">{formatKr(currentTotal)}</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-ink-disabled">This week</p>
                <p className={`font-semibold ${change && change.change > 0 ? 'text-cat-emerald-ink' : change && change.change < 0 ? 'text-cat-rose-ink' : 'text-ink-3'}`}>
                  {change ? `${formatSigned(change.change)} (${formatPct(change.changePct)})` : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-disabled">Total growth</p>
                <p className={`font-semibold ${growth > 0 ? 'text-cat-emerald-ink' : growth < 0 ? 'text-cat-rose-ink' : 'text-ink-3'}`}>
                  {formatSigned(growth)} ({formatPct(growthPct)})
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs text-ink-disabled">Deposited: {formatKr(contributedTotal)}</p>
          </div>

          {/* Per-portfolio cards */}
          <div className="grid grid-cols-1 gap-2">
            {latests.map(({ portfolio, latest, change, changePct }) => (
              <div key={portfolio.id} className="flex items-center justify-between rounded-[20px] border border-line bg-surface px-4 py-3 shadow-card">
                <div>
                  <p className="font-medium text-ink">{portfolio.name}</p>
                  <p className="text-xs text-ink-disabled">{latest ? formatKr(latest.total_value) : 'No data yet'}</p>
                </div>
                {change != null && (
                  <span className={`text-sm font-semibold ${change > 0 ? 'text-cat-emerald-ink' : change < 0 ? 'text-cat-rose-ink' : 'text-ink-disabled'}`}>
                    {formatSigned(change)} ({formatPct(changePct)})
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Trend chart */}
          {chart.length >= 2 && (
            <div className="rounded-3xl border border-line bg-surface p-4 shadow-card">
              <p className="mb-2 text-sm font-semibold text-ink">Trend</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eae3d5" />
                  <XAxis dataKey="date" stroke="#8b8577" fontSize={10} />
                  <YAxis stroke="#8b8577" fontSize={10} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip
                    contentStyle={{ background: '#fdfbf6', border: '1px solid #e9e2d4', fontSize: 12, borderRadius: 12, color: '#23241f' }}
                    formatter={(v) => formatKr(Number(v))}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="total" name="Total" stroke="#2f6b5a" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
                  {portfolios.map((p, i) => (
                    <Line
                      key={p.id}
                      type="monotone"
                      dataKey={p.name}
                      stroke={LINE_COLORS[i % LINE_COLORS.length]}
                      strokeWidth={1.5}
                      dot={{ r: 2 }}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Log this week */}
          <form onSubmit={submitWeek} className="rounded-3xl border border-line bg-surface p-4 shadow-card">
            <p className="mb-2 text-sm font-semibold text-ink">Log a week</p>
            <input
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              className="mb-3 w-full rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink outline-none focus:border-pine"
            />
            <div className="flex flex-col gap-3">
              {portfolios.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 truncate text-sm text-ink-2">{p.name}</span>
                  <input
                    type="number"
                    step="any"
                    placeholder="Value"
                    value={values[p.id] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))}
                    className="min-w-0 flex-1 rounded-[20px] border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder-ink-disabled outline-none focus:border-pine"
                  />
                  <input
                    type="number"
                    step="any"
                    placeholder="±Deposit"
                    value={contributions[p.id] ?? ''}
                    onChange={(e) => setContributions((c) => ({ ...c, [p.id]: e.target.value }))}
                    className="w-24 shrink-0 rounded-[20px] border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder-ink-disabled outline-none focus:border-pine"
                  />
                </div>
              ))}
            </div>
            <button type="submit" className="mt-3 w-full rounded-[20px] bg-cat-sky px-4 py-2.5 font-semibold text-white">
              Save
            </button>
          </form>

          {/* History */}
          {history.length > 0 && (
            <div className="rounded-3xl border border-line bg-surface p-4 shadow-card">
              <p className="mb-2 text-sm font-semibold text-ink">History</p>
              <ul className="flex flex-col divide-y divide-line">
                {history.map((row) => (
                  <li key={row.date} className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-sm font-medium text-ink">{row.date}</p>
                      {row.contribution !== 0 && (
                        <p className="text-xs text-ink-disabled">Deposit/withdrawal: {formatSigned(row.contribution)}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-ink">{formatKr(row.total)}</span>
                      <button onClick={() => setConfirmDeleteDate(row.date)} className="text-ink-faint">
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Manage portfolios */}
      <div className="rounded-3xl border border-line bg-surface p-4 shadow-card">
        <button
          onClick={() => setManagingPortfolios((v) => !v)}
          className="flex w-full items-center justify-between text-sm font-semibold text-ink"
        >
          Portfolios
          <span className="text-ink-disabled">{managingPortfolios ? '−' : '+'}</span>
        </button>
        {managingPortfolios && (
          <div className="mt-3 flex flex-col gap-2">
            {portfolios.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <input
                  defaultValue={p.name}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== p.name && renamePortfolio(p.id, e.target.value).then(load)}
                  className="min-w-0 flex-1 rounded-[20px] border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-pine"
                />
                <button onClick={() => setConfirmDeletePortfolio(p)} className="text-ink-faint">
                  ✕
                </button>
              </div>
            ))}
            <form onSubmit={submitNewPortfolio} className="flex gap-2">
              <input
                value={newPortfolioName}
                onChange={(e) => setNewPortfolioName(e.target.value)}
                placeholder="New portfolio name"
                className="min-w-0 flex-1 rounded-[20px] border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder-ink-disabled outline-none focus:border-pine"
              />
              <button type="submit" className="rounded-[20px] bg-cat-sky px-4 py-2 text-sm font-semibold text-white">
                Add
              </button>
            </form>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteDate != null}
        title="Delete this week's entry?"
        message={confirmDeleteDate ?? undefined}
        onCancel={() => setConfirmDeleteDate(null)}
        onConfirm={async () => {
          if (confirmDeleteDate) await deleteWeekEntries(confirmDeleteDate)
          setConfirmDeleteDate(null)
          await load()
        }}
      />
      <ConfirmDialog
        open={confirmDeletePortfolio != null}
        title="Delete this portfolio?"
        message={confirmDeletePortfolio ? `${confirmDeletePortfolio.name} — all its logged history will be deleted too.` : undefined}
        onCancel={() => setConfirmDeletePortfolio(null)}
        onConfirm={async () => {
          if (confirmDeletePortfolio) await deletePortfolio(confirmDeletePortfolio.id)
          setConfirmDeletePortfolio(null)
          await load()
        }}
      />
    </Screen>
  )
}
