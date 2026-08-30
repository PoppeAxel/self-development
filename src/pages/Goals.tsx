import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { weekStartISO } from '../lib/dates'
import { autoMetricProgress, rolloverRecurringGoals } from '../lib/goals'
import { AUTO_METRICS, isAutoMetric, METRIC_INFO } from '../lib/metrics'
import { ProgressRing } from '../components/ProgressRing'
import { RefreshButton } from '../components/RefreshButton'
import { GoalStatsView } from '../components/GoalStats'
import type { WeeklyGoal } from '../lib/types'

export function Goals() {
  const [view, setView] = useState<'goals' | 'stats'>('goals')
  const [goals, setGoals] = useState<WeeklyGoal[]>([])
  const [liveProgress, setLiveProgress] = useState<Map<string, number>>(new Map())
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('')
  const [recurring, setRecurring] = useState(false)
  const [autoMetric, setAutoMetric] = useState('')
  const [loading, setLoading] = useState(true)
  const weekStart = weekStartISO()

  async function load() {
    setLoading(true)
    await rolloverRecurringGoals()
    const { data } = await supabase
      .from('weekly_goals')
      .select('*')
      .eq('week_start', weekStart)
      .order('created_at')
    const loaded = (data ?? []) as WeeklyGoal[]
    setGoals(loaded)
    const autoGoals = loaded.filter((g) => isAutoMetric(g.auto_metric))
    if (autoGoals.length) {
      const entries = await Promise.all(autoGoals.map(async (g) => [g.id, await autoMetricProgress(g)] as const))
      setLiveProgress(new Map(entries))
    } else {
      setLiveProgress(new Map())
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addGoal(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('weekly_goals').insert({
      title: title.trim(),
      target_value: target ? Number(target) : null,
      week_start: weekStart,
      user_id: user.id,
      recurring: recurring || !!autoMetric,
      auto_metric: autoMetric || null,
    })
    setTitle('')
    setTarget('')
    setRecurring(false)
    setAutoMetric('')
    load()
  }

  async function bump(goal: WeeklyGoal, delta: number) {
    const progress = Math.max(0, goal.progress + delta)
    const status = goal.target_value && progress >= goal.target_value ? 'done' : 'active'
    setGoals((gs) => gs.map((g) => (g.id === goal.id ? { ...g, progress, status } : g)))
    await supabase.from('weekly_goals').update({ progress, status }).eq('id', goal.id)
  }

  async function remove(goal: WeeklyGoal) {
    setGoals((gs) => gs.filter((g) => g.id !== goal.id))
    await supabase.from('weekly_goals').delete().eq('id', goal.id)
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-6 pb-2">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Goals</h1>
        <RefreshButton onRefresh={load} />
      </div>
      <div className="flex gap-1 rounded-2xl bg-gray-100 p-1">
        {(['goals', 'stats'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 rounded-xl py-1.5 text-sm font-semibold capitalize transition ${
              view === v ? 'bg-white text-violet-600 shadow-sm' : 'text-gray-500'
            }`}
          >
            {v === 'goals' ? "This Week" : 'Stats'}
          </button>
        ))}
      </div>
      {view === 'stats' ? (
        <GoalStatsView />
      ) : loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : goals.length === 0 ? (
        <p className="text-sm text-gray-400">No goals yet for this week.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {goals.map((goal) => {
            const isAuto = isAutoMetric(goal.auto_metric)
            const progress = isAuto ? liveProgress.get(goal.id) ?? 0 : goal.progress
            const pct = goal.target_value ? Math.min(100, (progress / goal.target_value) * 100) : 0
            const done = isAuto ? goal.target_value != null && progress >= goal.target_value : goal.status === 'done'
            const metricInfo = isAutoMetric(goal.auto_metric) ? METRIC_INFO[goal.auto_metric] : null
            return (
              <li key={goal.id} className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className={`font-semibold ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{goal.title}</p>
                    <span
                      className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        done ? 'bg-emerald-100 text-emerald-600' : 'bg-pink-100 text-pink-600'
                      }`}
                    >
                      {done ? 'Done' : 'Active'}
                    </span>
                    {goal.recurring && (
                      <span className="ml-1.5 mt-1 inline-block rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-600">
                        ↻ Weekly
                      </span>
                    )}
                    {metricInfo && (
                      <span className="ml-1.5 mt-1 inline-block rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-600">
                        {metricInfo.icon} Auto
                      </span>
                    )}
                  </div>
                  <button onClick={() => remove(goal)} className="text-gray-300">
                    ✕
                  </button>
                </div>
                {goal.target_value ? (
                  <div className="mt-3 flex items-center gap-4">
                    <ProgressRing percent={pct} size={56} strokeWidth={6} color="#d97706" trackColor="#fef3c7">
                      <span className="text-xs font-bold text-gray-900">{Math.round(pct)}%</span>
                    </ProgressRing>
                    <div className="flex flex-1 items-center justify-between">
                      <span className="text-sm text-gray-500">
                        {progress.toLocaleString()} / {goal.target_value.toLocaleString()} {metricInfo?.unit ?? ''}
                      </span>
                      {!isAuto && (
                        <div className="flex gap-2">
                          <button onClick={() => bump(goal, -1)} className="h-8 w-8 rounded-full bg-gray-100 font-semibold text-gray-600">
                            −
                          </button>
                          <button onClick={() => bump(goal, 1)} className="h-8 w-8 rounded-full bg-violet-100 font-semibold text-violet-600">
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : isAuto ? null : (
                  <button
                    onClick={() =>
                      supabase
                        .from('weekly_goals')
                        .update({ status: done ? 'active' : 'done' })
                        .eq('id', goal.id)
                        .then(load)
                    }
                    className="mt-3 text-sm font-medium text-violet-600"
                  >
                    {done ? 'Mark as active' : 'Mark as done'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {view === 'goals' && (
        <form onSubmit={addGoal} className="flex flex-col gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New weekly goal"
            className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-violet-400"
          />
          <div className="flex gap-2">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="Target number (optional)"
              type="number"
              className="flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-violet-400"
            />
            <button type="submit" className="rounded-2xl bg-violet-600 px-4 py-2.5 font-semibold text-white">
              Add
            </button>
          </div>
          <select
            value={autoMetric}
            onChange={(e) => setAutoMetric(e.target.value)}
            className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 outline-none focus:border-violet-400"
          >
            <option value="">Manual progress (tap +/− to update)</option>
            {AUTO_METRICS.map((m) => (
              <option key={m} value={m}>
                Auto-track {METRIC_INFO[m].label}
              </option>
            ))}
          </select>
          {!autoMetric && (
            <label className="flex items-center gap-2 text-sm text-gray-500">
              <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="accent-violet-600" />
              Recurring every week
            </label>
          )}
        </form>
      )}
    </div>
  )
}
