import { useEffect, useMemo, useRef, useState } from 'react'
import { Area, ComposedChart, LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'
import { todayISO, weekStartISO } from '../lib/dates'
import { CATEGORY_STYLES } from '../lib/categories'
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
  totalsWithDeposits,
  weeklyLogDue,
  yearEndProjection,
  weekTotals,
} from '../lib/finance'
import type { Portfolio, PortfolioEntry } from '../lib/types'

// One hue per portfolio, in the order they were added — the same muted set the rest of
// the app uses, so a portfolio's row edge and its chart line agree.
const PORTFOLIO_HUES = [
  CATEGORY_STYLES.sky.accent,
  CATEGORY_STYLES.violet.accent,
  CATEGORY_STYLES.amber.accent,
  CATEGORY_STYLES.emerald.accent,
  CATEGORY_STYLES.pink.accent,
]

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
  const logFormRef = useRef<HTMLFormElement>(null)

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
  const logDue = useMemo(() => weeklyLogDue(entries, weekStartISO()), [entries])
  const projection = useMemo(() => yearEndProjection(totals), [totals])

  // The last twelve logged weeks, with the projection carried as its own key on the final
  // real point and on a year-end point appended after it — that's what makes the dashed
  // continuation a single connected segment instead of a whole second line.
  const depositsChart = useMemo(() => {
    const rows = totalsWithDeposits(entries).slice(-12)
    if (rows.length === 0) return []
    const shaped: Record<string, number | string | null>[] = rows.map((r, i) => ({
      date: r.date.slice(5),
      total: r.total,
      deposited: r.deposited,
      projected: projection && i === rows.length - 1 ? r.total : null,
    }))
    if (projection) shaped.push({ date: projection.date.slice(5), total: null, deposited: null, projected: projection.value })
    return shaped
  }, [entries, projection])

  const hero = (
    <>
      <p className="mt-[18px] text-[40px] font-semibold leading-none">
        {Math.round(currentTotal).toLocaleString('sv-SE')}
        <span className="ml-1 text-base font-medium">kr</span>
      </p>
      {contributedTotal > 0 && (
        <>
          <div className="mt-3 flex gap-[5px]">
            <span className="h-2 rounded-full bg-white/35" style={{ flex: Math.max(contributedTotal, 1) }} />
            {growth > 0 && <span className="h-2 rounded-full bg-pine-arc" style={{ flex: growth }} />}
          </div>
          <div className="mt-2 flex gap-3.5 text-xs font-medium text-white">
            <span>Deposited {Math.round(contributedTotal).toLocaleString('sv-SE')}</span>
            <span className="font-semibold">
              Growth {growth >= 0 ? '+' : '−'}
              {Math.round(Math.abs(growth)).toLocaleString('sv-SE')}
            </span>
          </div>
        </>
      )}
    </>
  )

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
    <Screen title="Finance" onRefresh={load} hero={hero}>

      {loading ? (
        <p className="text-sm text-ink-disabled">Loading…</p>
      ) : portfolios.length === 0 ? (
        <div className="rounded-3xl border border-line bg-surface p-4 shadow-card">
          <p className="text-sm text-ink-3">No portfolios yet — add your first one below.</p>
        </div>
      ) : (
        <>
          {logDue && (
            <div className="flex items-center gap-3 rounded-[22px] bg-cat-amber-tint px-4 py-3.5">
              <span className="text-base">📅</span>
              <span className="flex-1 text-[13px] leading-snug text-ink-2">
                No log for this week yet. Values prefill from last week.
              </span>
              <button
                onClick={() => {
                  setLogDate(todayISO())
                  logFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }}
                className="shrink-0 rounded-2xl bg-cat-amber-ink px-3.5 py-2.5 text-[13px] font-semibold text-white"
              >
                Log
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-[20px] border border-line bg-surface px-3.5 py-3 shadow-card">
              <p className="text-xs font-medium text-ink-muted">This week</p>
              <p
                className={`mt-0.5 text-xl font-semibold ${
                  change && change.change > 0 ? 'text-cat-emerald-ink' : change && change.change < 0 ? 'text-cat-rose-ink' : 'text-ink'
                }`}
              >
                {change ? formatSigned(change.change) : '—'}
              </p>
              <p
                className={`mt-0.5 text-xs font-semibold ${
                  change && change.change > 0 ? 'text-cat-emerald-ink' : change && change.change < 0 ? 'text-cat-rose-ink' : 'text-ink-muted'
                }`}
              >
                {change ? formatPct(change.changePct) : 'nothing to compare yet'}
              </p>
            </div>
            <div className="rounded-[20px] border border-line bg-surface px-3.5 py-3 shadow-card">
              <p className="text-xs font-medium text-ink-muted">Return on deposits</p>
              <p className={`mt-0.5 text-xl font-semibold ${growth > 0 ? 'text-cat-emerald-ink' : growth < 0 ? 'text-cat-rose-ink' : 'text-ink'}`}>
                {formatPct(growthPct)}
              </p>
              <p className="mt-0.5 text-xs font-medium text-ink-3">since start</p>
            </div>
          </div>

          {/* Total, with everything paid in shaded beneath it, so market movement reads
              as the gap between the two rather than a number you have to work out. */}
          {depositsChart.length >= 2 && (
            <div className="rounded-3xl border border-line bg-surface p-4 shadow-card">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">Total, with deposits shaded</p>
                <span className="text-[11px] font-semibold text-ink-muted">{depositsChart.length} weeks</span>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <ComposedChart data={depositsChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eae3d5" />
                  <XAxis dataKey="date" stroke="#8b8577" fontSize={10} />
                  <YAxis stroke="#8b8577" fontSize={10} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip
                    contentStyle={{ background: '#fdfbf6', border: '1px solid #e9e2d4', fontSize: 12, borderRadius: 12, color: '#23241f' }}
                    formatter={(v, name) => [formatKr(Number(v)), name === 'deposited' ? 'Deposited' : name === 'total' ? 'Total' : 'Projected']}
                  />
                  <Area type="monotone" dataKey="deposited" stroke="none" fill="#dcd3c0" isAnimationActive={false} />
                  <Area type="monotone" dataKey="total" stroke="#2f6b5a" strokeWidth={2.5} fill="#2f6b5a" fillOpacity={0.16} isAnimationActive={false} />
                  {/* Present only on the last real point and the year-end one, so this
                      draws as a single dashed continuation rather than a second series. */}
                  <Line
                    type="linear"
                    dataKey="projected"
                    stroke="#2f6b5a"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              {projection && (
                <p className="mt-2 text-xs text-ink-3">
                  At this pace you'd end the year near{' '}
                  <strong className="font-semibold text-ink">{formatKr(projection.value)}</strong>.
                </p>
              )}
            </div>
          )}

          {/* Per-portfolio rows */}
          <div className="flex flex-col gap-2">
            {latests.map(({ portfolio, latest, change: pChange, changePct }, i) => {
              const hue = PORTFOLIO_HUES[i % PORTFOLIO_HUES.length]
              const share = currentTotal !== 0 && latest ? (latest.total_value / currentTotal) * 100 : null
              return (
                <div
                  key={portfolio.id}
                  className="flex items-center gap-3 overflow-hidden rounded-[20px] border border-line bg-surface shadow-card"
                >
                  <span className="w-[5px] shrink-0 self-stretch" style={{ background: hue }} />
                  <span className="min-w-0 flex-1 py-3">
                    <span className="block truncate text-sm font-medium text-ink">{portfolio.name}</span>
                    <span className="block truncate text-[11px] text-ink-muted">
                      {latest ? formatKr(latest.total_value) : 'No data yet'}
                      {share != null && ` · ${Math.round(share)}% of total`}
                    </span>
                  </span>
                  {pChange != null && (
                    <span
                      className={`mr-4 shrink-0 text-[13px] font-semibold ${
                        pChange > 0 ? 'text-cat-emerald-ink' : pChange < 0 ? 'text-cat-rose-ink' : 'text-ink-muted'
                      }`}
                    >
                      {formatPct(changePct)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Per-portfolio trend, kept from before — the shaded chart above answers
              "how is it going", this one answers "which part". */}
          {chart.length >= 2 && (
            <div className="rounded-3xl border border-line bg-surface p-4 shadow-card">
              <p className="mb-2 text-sm font-semibold text-ink">By portfolio</p>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eae3d5" />
                  <XAxis dataKey="date" stroke="#8b8577" fontSize={10} />
                  <YAxis stroke="#8b8577" fontSize={10} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip
                    contentStyle={{ background: '#fdfbf6', border: '1px solid #e9e2d4', fontSize: 12, borderRadius: 12, color: '#23241f' }}
                    formatter={(v) => formatKr(Number(v))}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {portfolios.map((p, i) => (
                    <Line
                      key={p.id}
                      type="monotone"
                      dataKey={p.name}
                      stroke={PORTFOLIO_HUES[i % PORTFOLIO_HUES.length]}
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
          <form ref={logFormRef} onSubmit={submitWeek} className="rounded-3xl border border-line bg-surface p-4 shadow-card">
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
