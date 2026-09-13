import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'
import { PARENT_PERIOD, PERIOD_LABELS, PERIOD_TYPES, periodEndISO, periodStartISO, weekStartISO } from '../lib/dates'
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

// Nested bars step toward the card surface rather than using hand-picked tints per
// category — mixing the accent with the card colour gives the design's mid/light pair
// (Training #c07a60 / #d19c88) for every hue, including ones the design never drew.
function depthTint(accent: string, depth: number): string {
  if (depth === 0) return accent
  const weight = depth === 1 ? 75 : 55
  return `color-mix(in srgb, ${accent} ${weight}%, ${THEME.surface})`
}

const DEPTH_BAR_HEIGHT = ['h-2', 'h-1.5', 'h-[5px]']

// A child node's short prefix: "Q3", "Sep", "This week". The parent card already says
// which goal this rolls into, so the node only has to say when it is.
function periodNodeLabel(goal: Goal): string {
  const start = new Date(goal.period_start + 'T00:00:00')
  switch (goal.period_type) {
    case 'year':
      return format(start, 'yyyy')
    case 'quarter':
      return `Q${Math.floor(start.getMonth() / 3) + 1}`
    case 'month':
      return format(start, 'MMM')
    case 'week':
      return goal.period_start === weekStartISO() ? 'This week' : `Week of ${format(start, 'MMM d')}`
  }
}

interface TreeNode {
  goal: Goal
  progress: number
  isRollup: boolean
  children: TreeNode[]
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
  // A view switch, not a period — Tree shows the selected period's goals with whatever
  // rolls into them nested underneath; List is the flat view this page has always had.
  const [view, setView] = useState<'tree' | 'list'>('list')
  const [tree, setTree] = useState<TreeNode[]>([])
  const [unlinkedCount, setUnlinkedCount] = useState(0)
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

  // Tree view needs every goal, not just this period's, to follow a chain down through
  // quarters and months to weeks. Only fetched when that view is actually open.
  useEffect(() => {
    if (view !== 'tree') return
    let cancelled = false

    async function loadTree() {
      const { data } = await supabase.from('goals').select('*').order('created_at')
      if (cancelled) return
      const all = (data ?? []) as Goal[]
      const roots = all.filter((g) => g.period_type === periodType && g.period_start === periodStart)

      // A child belongs to this node when it points at the series AND its period falls
      // inside the parent's — the same containment rule resolveGoalProgress uses.
      function childrenOf(goal: Goal): Goal[] {
        const end = periodEndISO(goal.period_type, goal.period_start)
        return all.filter(
          (g) => g.parent_series_id === goal.series_id && g.period_start >= goal.period_start && g.period_start <= end,
        )
      }

      async function build(goal: Goal): Promise<TreeNode> {
        const [resolved, children] = await Promise.all([
          resolveGoalProgress(goal),
          Promise.all(childrenOf(goal).map(build)),
        ])
        return { goal, progress: resolved.progress, isRollup: resolved.isRollup, children }
      }

      const built = await Promise.all(roots.map(build))
      if (cancelled) return
      setTree(built)
      // "Unlinked" = a goal in this period that neither feeds anything nor is fed by
      // anything, so the rollup view has nothing to show for it.
      setUnlinkedCount(roots.filter((g) => !g.parent_series_id && childrenOf(g).length === 0).length)
    }

    loadTree()
    return () => {
      cancelled = true
    }
  }, [view, periodType, periodStart, goals])

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

  // One node of the rollup chain: the bar thins and the fill lightens with each level, so
  // depth reads without needing a label for it.
  function renderNode(node: TreeNode, depth: number, accent: string) {
    const { goal, progress, children } = node
    const pct = goal.target_value ? Math.min(100, (progress / goal.target_value) * 100) : 0
    return (
      <div key={goal.id}>
        <div className="flex items-center justify-between gap-2">
          <span className={`min-w-0 truncate ${depth === 1 ? 'text-sm font-medium text-ink' : 'text-[13px] font-medium text-ink-2'}`}>
            {periodNodeLabel(goal)} · {goal.title}
          </span>
          {goal.target_value != null && (
            <span className="shrink-0 text-xs font-semibold text-ink-2">
              {Math.round(progress).toLocaleString()} / {goal.target_value.toLocaleString()}
            </span>
          )}
        </div>
        <span className={`mt-1.5 block overflow-hidden rounded-full bg-ring-track ${DEPTH_BAR_HEIGHT[Math.min(depth, 2)]}`}>
          <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: depthTint(accent, depth) }} />
        </span>
        {children.length > 0 && (
          <div className="mt-2.5 flex flex-col gap-2.5 border-l-2 border-ring-track pl-3.5">
            {children.map((child) => renderNode(child, depth + 1, accent))}
          </div>
        )}
      </div>
    )
  }

  const hero = (
    <>
      <HeroSegments
        options={PERIOD_TYPES.map((p) => ({ id: p, label: PERIOD_LABELS[p] }))}
        value={periodType}
        onChange={setPeriodType}
      />
      <div className="mt-2 flex items-center gap-2">
        {(['tree', 'list'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-[14px] px-3.5 py-2 text-xs capitalize transition ${
              view === v ? 'bg-surface font-semibold text-pine-dark' : 'bg-white/14 font-medium text-white'
            }`}
          >
            {v}
          </button>
        ))}
        <span className="text-[11px] font-medium text-white">view</span>
      </div>
      {view === 'tree' && (
        <p className="mt-[18px] text-[15px] font-medium leading-relaxed text-white">
          Every {PERIOD_LABELS[periodType].toLowerCase()} goal, and what rolls into it.
        </p>
      )}
      {view === 'list' && !loading && goals.length > 0 && (
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
      {view === 'tree' && (
        <>
          {tree.length === 0 ? (
            <p className="text-sm text-ink-disabled">No {PERIOD_LABELS[periodType].toLowerCase()} goals yet.</p>
          ) : (
            <ul className="flex flex-col gap-3.5">
              {tree.map((node) => {
                const { goal, progress, isRollup, children } = node
                const done = goal.target_value != null && progress >= goal.target_value
                const style = goalHue(goal, done, isRollup)
                const pct = goal.target_value ? Math.min(100, (progress / goal.target_value) * 100) : 0
                const metricInfo = isGoalMetric(goal.auto_metric) ? goalMetricInfo(goal.auto_metric) : null
                const chip = [
                  metricInfo ? `${metricInfo.icon} auto` : isRollup ? '🔗 rollup' : 'manual',
                  PERIOD_LABELS[goal.period_type].toLowerCase(),
                ].join(' · ')
                return (
                  <li key={goal.id} className="flex overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
                    <span className="w-[5px] shrink-0 self-stretch" style={{ background: style.accent }} />
                    <div className="min-w-0 flex-1 px-[18px] py-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span
                            className="inline-block rounded-full px-2.5 py-[3px] text-[11px] font-semibold"
                            style={{ background: style.tint, color: style.ink }}
                          >
                            {chip}
                          </span>
                          <p className="mt-2 text-[17px] font-semibold text-ink">{goal.title}</p>
                        </div>
                        {goal.target_value != null && (
                          <span className="shrink-0 text-xl font-semibold" style={{ color: style.ink }}>
                            {Math.round(pct)}%
                          </span>
                        )}
                      </div>
                      <span className="mt-2.5 block h-2 overflow-hidden rounded-full bg-ring-track">
                        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: style.accent }} />
                      </span>
                      {children.length > 0 && (
                        <div className="mt-3.5 flex flex-col gap-2.5 border-l-2 border-ring-track pl-3.5">
                          {children.map((child) => renderNode(child, 1, style.accent))}
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="flex items-center justify-between gap-3 rounded-[20px] border border-line-strong bg-surface px-4 py-3.5">
            <button onClick={() => setView('list')} className="text-sm font-semibold text-pine">
              + New goal
            </button>
            {unlinkedCount > 0 && (
              <span className="shrink-0 text-xs font-medium text-ink-muted">
                {unlinkedCount} unlinked
              </span>
            )}
          </div>
        </>
      )}

      {view === 'list' &&
        (loading ? (
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
        ))}

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
