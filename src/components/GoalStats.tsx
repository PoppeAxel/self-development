import { useEffect, useState } from 'react'
import { computeGoalStats, goalMetricInfo, type GoalStats } from '../lib/goals'
import { monthStartISO, todayISO, weekStartISO } from '../lib/dates'
import { ProgressRing } from './ProgressRing'

type Period = 'week' | 'month' | 'all'
const PERIOD_LABELS: Record<Period, string> = { week: 'This Week', month: 'This Month', all: 'All Time' }

// Goals are only ever inserted going forward from when a user starts using the feature, so
// a fixed lookback comfortably covers "all time" without an extra query to find the earliest row.
const ALL_TIME_LOOKBACK_DAYS = 365 * 3

function periodRange(period: Period): [string, string] {
  const today = todayISO()
  if (period === 'week') return [weekStartISO(), today]
  if (period === 'month') return [monthStartISO(), today]
  const start = new Date()
  start.setDate(start.getDate() - ALL_TIME_LOOKBACK_DAYS)
  return [weekStartISO(start), today]
}

export function GoalStatsView() {
  const [period, setPeriod] = useState<Period>('week')
  const [stats, setStats] = useState<GoalStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const [start, end] = periodRange(period)
    computeGoalStats(start, end).then((s) => {
      setStats(s)
      setLoading(false)
    })
  }, [period])

  const completionPct = stats && stats.totalGoals > 0 ? Math.round((stats.completedGoals / stats.totalGoals) * 100) : 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 rounded-2xl bg-gray-100 p-1">
        {(['week', 'month', 'all'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 rounded-xl py-1.5 text-xs font-semibold transition ${
              period === p ? 'bg-white text-violet-600 shadow-sm' : 'text-gray-500'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !stats || stats.totalGoals === 0 ? (
        <p className="text-sm text-gray-400">No goals in this period yet.</p>
      ) : (
        <>
          <div className="flex items-center gap-4 rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
            <ProgressRing percent={completionPct} size={56} strokeWidth={6} color="#7c3aed" trackColor="#ede9fe">
              <span className="text-xs font-bold text-gray-900">{completionPct}%</span>
            </ProgressRing>
            <div>
              <p className="font-semibold text-gray-900">Goals completed</p>
              <p className="text-sm text-gray-500">
                {stats.completedGoals} of {stats.totalGoals} for {PERIOD_LABELS[period].toLowerCase()}
              </p>
            </div>
          </div>
          {stats.metrics.map(({ metric, achieved, target }) => {
            const info = goalMetricInfo(metric)
            const pct = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0
            return (
              <div key={metric} className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
                <p className="font-semibold text-gray-900">
                  {info.icon} {info.label}
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-violet-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="whitespace-nowrap text-sm text-gray-500">
                    {achieved.toLocaleString()} / {target.toLocaleString()} {info.unit}
                  </span>
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
