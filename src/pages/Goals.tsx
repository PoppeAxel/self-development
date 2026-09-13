import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PARENT_PERIOD, PERIOD_LABELS, PERIOD_TYPES, periodStartISO } from '../lib/dates'
import { goalMetricInfo, isGoalMetric, resolveGoalProgress, rolloverRecurringGoals, SESSION_METRIC_INFO, SESSION_METRICS } from '../lib/goals'
import { AUTO_METRICS, METRIC_INFO } from '../lib/metrics'
import { CATEGORY_STYLES } from '../lib/categories'
import { THEME } from '../lib/theme'
import { ProgressRing } from '../components/ProgressRing'
import { Screen, HeroSegments } from '../components/Screen'
import type { Goal, PeriodType } from '../lib/types'

// Goals have no category column of their own, so the card's accent hue comes from what
// drives the goal instead: a finished goal and a sleep target read as Health pine, any
// other synced metric as Training terracotta, a roll-up of sub-goals as Work blue, and a
// plain manual goal as General plum.
function goalHue(goal: Goal, done: boolean, isRollup: boolean) {
  if (done || goal.auto_metric === 'sleep_hours') return CATEGORY_STYLES.emerald
  if (isGoalMetric(goal.auto_metric)) return CATEGORY_STYLES.pink
  if (isRollup) return CATEGORY_STYLES.sky
  return CATEGORY_STYLES.violet
}

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

  const hero = (
    <>
      <HeroSegments
        options={PERIOD_TYPES.map((p) => ({ id: p, label: PERIOD_LABELS[p] }))}
        value={periodType}
        onChange={setPeriodType}
      />
      {!loading && goals.length > 0 && (
        <div className="mt-[18px] flex items-center gap-3.5">
          <ProgressRing
            percent={(completedCount / goals.length) * 100}
            size={54}
            strokeWidth={5}
            color={THEME.pineArc}
            trackColor={THEME.heroRingTrack}
            disc={THEME.pineDisc}
          >
            <span className="text-[13px] font-semibold text-white">
              {completedCount}/{goals.length}
            </span>
          </ProgressRing>
          <p className="text-sm font-medium text-white">
            {completedCount} of {goals.length} done this {PERIOD_LABELS[periodType].toLowerCase().replace('ly', '')}
          </p>
        </div>
      )}
    </>
  )

  return (
    <Screen title="Goals" onRefresh={load} hero={hero}>
      {loading ? (
        <p className="text-sm text-ink-disabled">Loading…</p>
      ) : goals.length === 0 ? (
        <p className="text-sm text-ink-disabled">No {PERIOD_LABELS[periodType].toLowerCase()} goals yet.</p>
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
            const style = goalHue(goal, done, isRollup)
            // One chip instead of four badges — what drives the goal, then its state.
            const chipParts = [
              metricInfo ? `${metricInfo.icon} auto` : isRollup ? '🔗 from sub-goals' : null,
              goal.recurring && !metricInfo ? `↻ ${PERIOD_LABELS[periodType].toLowerCase()}` : null,
              done ? 'done' : null,
            ].filter(Boolean)
            return (
              <li
                key={goal.id}
                className="flex overflow-hidden rounded-3xl border border-line bg-surface shadow-card"
              >
                <span className="w-[5px] self-stretch" style={{ background: style.accent }} />
                <div className="min-w-0 flex-1 px-[18px] py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-[17px] font-semibold ${done ? 'text-ink-disabled line-through' : 'text-ink'}`}>{goal.title}</p>
                      <span
                        className="mt-1.5 inline-block rounded-full px-2.5 py-[3px] text-[11px] font-semibold"
                        style={{ background: style.tint, color: style.ink }}
                      >
                        {chipParts.length ? chipParts.join(' · ') : 'active'}
                      </span>
                    </div>
                    <button onClick={() => remove(goal)} className="shrink-0 text-ink-faint" aria-label="Remove goal">
                      ✕
                    </button>
                  </div>
                  {goal.target_value ? (
                    <div className="mt-3.5 flex items-center gap-3.5">
                      <ProgressRing percent={pct} size={56} strokeWidth={6} color={style.accent} disc={THEME.surface}>
                        <span className="text-[13px] font-semibold text-ink">{Math.round(pct)}%</span>
                      </ProgressRing>
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                        <span className="truncate text-[15px] font-medium text-ink-2">
                          {value.toLocaleString()} / {goal.target_value.toLocaleString()} {metricInfo?.unit ?? ''}
                        </span>
                        {!isAuto && (
                          <div className="flex shrink-0 gap-2">
                            <button
                              onClick={() => bump(goal, -1)}
                              className="h-[34px] w-[34px] rounded-full bg-track font-semibold text-ink-3"
                            >
                              −
                            </button>
                            <button
                              onClick={() => bump(goal, 1)}
                              className="h-[34px] w-[34px] rounded-full font-semibold text-white"
                              style={{ background: style.check }}
                            >
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
                      className="mt-3 text-sm font-semibold"
                      style={{ color: style.ink }}
                    >
                      {done ? 'Mark as active' : 'Mark as done'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <form onSubmit={addGoal} className="flex flex-col gap-2.5">
        <div className="flex gap-2.5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`New ${PERIOD_LABELS[periodType].toLowerCase()} goal`}
            className="min-w-0 flex-1 rounded-[20px] border border-line bg-surface px-4 py-3 text-sm text-ink placeholder-ink-disabled outline-none focus:border-pine"
          />
          <button type="submit" className="shrink-0 rounded-[20px] bg-pine px-5 py-3 text-sm font-semibold text-white">
            Add
          </button>
        </div>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="Target number (optional)"
          type="number"
          className="rounded-[20px] border border-line bg-surface px-4 py-3 text-sm text-ink placeholder-ink-disabled outline-none focus:border-pine"
        />
        <select
          value={autoMetric}
          onChange={(e) => setAutoMetric(e.target.value)}
          className="rounded-[20px] border border-line bg-surface px-4 py-3 text-sm text-ink outline-none focus:border-pine"
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
            className="rounded-[20px] border border-line bg-surface px-4 py-3 text-sm text-ink outline-none focus:border-pine"
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
          <label className="flex items-center gap-2 text-sm text-ink-3">
            <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="accent-pine" />
            Recurring every {PERIOD_LABELS[periodType].toLowerCase().replace('ly', '')}
          </label>
        )}
      </form>
    </Screen>
  )
}
