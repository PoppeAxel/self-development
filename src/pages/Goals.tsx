import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PARENT_PERIOD, PERIOD_LABELS, PERIOD_TYPES, periodStartISO } from '../lib/dates'
import { goalMetricInfo, isGoalMetric, resolveGoalProgress, rolloverRecurringGoals, SESSION_METRIC_INFO, SESSION_METRICS } from '../lib/goals'
import { AUTO_METRICS, METRIC_INFO } from '../lib/metrics'
import { ProgressRing } from '../components/ProgressRing'
import { RefreshButton } from '../components/RefreshButton'
import type { Goal, PeriodType } from '../lib/types'

export function Goals() {
  const [periodType, setPeriodType] = useState<PeriodType>('week')
  const [goals, setGoals] = useState<Goal[]>([])
  const [progress, setProgress] = useState<Map<string, { progress: number; isRollup: boolean }>>(new Map())
  const [parentOptions, setParentOptions] = useState<Goal[]>([])
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('')
  const [recurring, setRecurring] = useState(false)
  const [autoMetric, setAutoMetric] = useState('')
  const [parentSeriesId, setParentSeriesId] = useState('')
  const [loading, setLoading] = useState(true)
  const periodStart = periodStartISO(periodType)
  const parentPeriod = PARENT_PERIOD[periodType]

  async function load() {
    setLoading(true)
    await rolloverRecurringGoals()
    const { data } = await supabase
      .from('goals')
      .select('*')
      .eq('period_type', periodType)
      .eq('period_start', periodStart)
      .order('created_at')
    const loaded = (data ?? []) as Goal[]
    setGoals(loaded)
    const entries = await Promise.all(loaded.map(async (g) => [g.id, await resolveGoalProgress(g)] as const))
    setProgress(new Map(entries))

    if (parentPeriod) {
      const { data: parents } = await supabase
        .from('goals')
        .select('*')
        .eq('period_type', parentPeriod)
        .eq('period_start', periodStartISO(parentPeriod))
        .order('created_at')
      setParentOptions((parents ?? []) as Goal[])
    } else {
      setParentOptions([])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodType])

  async function addGoal(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('goals').insert({
      title: title.trim(),
      target_value: target ? Number(target) : null,
      period_type: periodType,
      period_start: periodStart,
      user_id: user.id,
      recurring: recurring || !!autoMetric,
      auto_metric: autoMetric || null,
      parent_series_id: parentSeriesId || null,
    })
    setTitle('')
    setTarget('')
    setRecurring(false)
    setAutoMetric('')
    setParentSeriesId('')
    load()
  }

  async function bump(goal: Goal, delta: number) {
    const newProgress = Math.max(0, goal.progress + delta)
    const status = goal.target_value && newProgress >= goal.target_value ? 'done' : 'active'
    setGoals((gs) => gs.map((g) => (g.id === goal.id ? { ...g, progress: newProgress, status } : g)))
    setProgress((p) => new Map(p).set(goal.id, { progress: newProgress, isRollup: false }))
    await supabase.from('goals').update({ progress: newProgress, status }).eq('id', goal.id)
  }

  async function remove(goal: Goal) {
    setGoals((gs) => gs.filter((g) => g.id !== goal.id))
    await supabase.from('goals').delete().eq('id', goal.id)
  }

  const completedCount = goals.filter((g) => {
    const p = progress.get(g.id)
    const isAuto = isGoalMetric(g.auto_metric) || p?.isRollup
    return isAuto ? g.target_value != null && (p?.progress ?? 0) >= g.target_value : g.status === 'done'
  }).length

  return (
    <div className="flex flex-col gap-4 px-4 pt-6 pb-2">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Goals</h1>
        <RefreshButton onRefresh={load} />
      </div>
      <div className="flex gap-1 rounded-2xl bg-gray-100 p-1">
        {PERIOD_TYPES.map((p) => (
          <button
            key={p}
            onClick={() => setPeriodType(p)}
            className={`flex-1 rounded-xl py-1.5 text-xs font-semibold transition ${
              periodType === p ? 'bg-white text-violet-600 shadow-sm' : 'text-gray-500'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>
      {!loading && goals.length > 0 && (
        <div className="flex items-center gap-3 rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
          <ProgressRing percent={(completedCount / goals.length) * 100} size={48} strokeWidth={5} color="#7c3aed" trackColor="#ede9fe">
            <span className="text-xs font-bold text-gray-900">
              {completedCount}/{goals.length}
            </span>
          </ProgressRing>
          <p className="text-sm text-gray-500">
            {completedCount} of {goals.length} {PERIOD_LABELS[periodType].toLowerCase()} goals done
          </p>
        </div>
      )}
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : goals.length === 0 ? (
        <p className="text-sm text-gray-400">No {PERIOD_LABELS[periodType].toLowerCase()} goals yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {goals.map((goal) => {
            const goalProgress = progress.get(goal.id)
            const isRollup = goalProgress?.isRollup ?? false
            const isAuto = isGoalMetric(goal.auto_metric) || isRollup
            const value = isAuto ? goalProgress?.progress ?? 0 : goal.progress
            const pct = goal.target_value ? Math.min(100, (value / goal.target_value) * 100) : 0
            const done = isAuto ? goal.target_value != null && value >= goal.target_value : goal.status === 'done'
            const metricInfo = isGoalMetric(goal.auto_metric) ? goalMetricInfo(goal.auto_metric) : null
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
                        ↻ {PERIOD_LABELS[periodType]}
                      </span>
                    )}
                    {metricInfo && (
                      <span className="ml-1.5 mt-1 inline-block rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-600">
                        {metricInfo.icon} Auto
                      </span>
                    )}
                    {isRollup && (
                      <span className="ml-1.5 mt-1 inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-600">
                        🔗 From sub-goals
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
                        {value.toLocaleString()} / {goal.target_value.toLocaleString()} {metricInfo?.unit ?? ''}
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
                        .from('goals')
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
      <form onSubmit={addGoal} className="flex flex-col gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`New ${PERIOD_LABELS[periodType].toLowerCase()} goal`}
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
          <optgroup label="Track a daily total">
            {AUTO_METRICS.map((m) => (
              <option key={m} value={m}>
                Auto-track {METRIC_INFO[m].label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Track number of sessions">
            {SESSION_METRICS.map((m) => (
              <option key={m} value={m}>
                Auto-track {SESSION_METRIC_INFO[m].label}
              </option>
            ))}
          </optgroup>
        </select>
        {parentPeriod && (
          <select
            value={parentSeriesId}
            onChange={(e) => setParentSeriesId(e.target.value)}
            className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 outline-none focus:border-violet-400"
          >
            <option value="">No parent goal</option>
            {parentOptions.map((g) => (
              <option key={g.id} value={g.series_id}>
                Roll up into: {g.title} ({PERIOD_LABELS[parentPeriod]})
              </option>
            ))}
          </select>
        )}
        {!autoMetric && (
          <label className="flex items-center gap-2 text-sm text-gray-500">
            <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="accent-violet-600" />
            Recurring every {PERIOD_LABELS[periodType].toLowerCase().replace('ly', '')}
          </label>
        )}
      </form>
    </div>
  )
}
