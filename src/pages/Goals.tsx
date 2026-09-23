import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'
import { PARENT_PERIOD, PERIOD_LABELS, PERIOD_TYPES, periodStartISO } from '../lib/dates'
import {
  goalMetricInfo,
  goalPace,
  isGoalDone,
  isGoalMetric,
  isOffPace,
  paceVerdict,
  resolveGoalProgress,
  rolloverRecurringGoals,
  SESSION_METRIC_INFO,
  SESSION_METRICS,
  type GoalPace,
} from '../lib/goals'
import { AUTO_METRICS, METRIC_INFO } from '../lib/metrics'
import { CATEGORY_STYLES } from '../lib/categories'
import { useNav } from '../contexts/NavContext'
import { Screen } from '../components/Screen'
import { DaysRing, PaceBars, PaceLegend, VerdictChip } from '../components/Pace'
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

// Sections run longest-horizon first, so the year frames the quarter that frames the week.
const SECTION_ORDER: PeriodType[] = ['year', 'quarter', 'month', 'week']

function sectionHeading(periodType: PeriodType, periodStart: string): string {
  const start = new Date(periodStart + 'T00:00:00')
  switch (periodType) {
    case 'year':
      return 'YEAR'
    case 'quarter':
      return `Q${Math.floor(start.getMonth() / 3) + 1}`
    case 'month':
      return format(start, 'MMMM').toUpperCase()
    case 'week':
      return 'THIS WEEK'
  }
}

type GoalFilter = 'all' | 'offPace' | 'done'

interface ResolvedGoal {
  goal: Goal
  progress: number
  isRollup: boolean
  pace: GoalPace
  done: boolean
  offPace: boolean
}

export function Goals() {
  const { openGoalDetail } = useNav()
  const [rows, setRows] = useState<ResolvedGoal[]>([])
  const [taskCounts, setTaskCounts] = useState<Map<string, number>>(new Map())
  // Every goal by series, so a card can name the parent it rolls into and count the
  // children that roll into it without a second round of queries.
  const [goalsBySeries, setGoalsBySeries] = useState<Map<string, Goal>>(new Map())
  const [childCounts, setChildCounts] = useState<Map<string, number>>(new Map())
  const [filter, setFilter] = useState<GoalFilter>('all')
  const [loading, setLoading] = useState(true)

  // Create form. The period select replaces the removed pills as the way to pick a horizon.
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('')
  const [formPeriod, setFormPeriod] = useState<PeriodType>('week')
  const [recurring, setRecurring] = useState(false)
  const [autoMetric, setAutoMetric] = useState('')
  const [parentSeriesId, setParentSeriesId] = useState('')
  const [parentOptions, setParentOptions] = useState<Goal[]>([])
  const formParentPeriod = PARENT_PERIOD[formPeriod]

  async function load() {
    setLoading(true)
    await rolloverRecurringGoals()
    // One fetch of every goal rather than four period-scoped ones: the table is small, and
    // having them all means parent titles and child counts need no extra round trips.
    const [{ data: goalRows }, { data: taskRows }] = await Promise.all([
      supabase.from('goals').select('*').order('created_at'),
      supabase.from('daily_tasks').select('goal_series_id').eq('active', true).not('goal_series_id', 'is', null),
    ])
    const all = (goalRows ?? []) as Goal[]

    const bySeries = new Map<string, Goal>()
    const children = new Map<string, number>()
    for (const g of all) {
      if (!bySeries.has(g.series_id)) bySeries.set(g.series_id, g)
      if (g.parent_series_id) children.set(g.parent_series_id, (children.get(g.parent_series_id) ?? 0) + 1)
    }
    setGoalsBySeries(bySeries)
    setChildCounts(children)

    const counts = new Map<string, number>()
    for (const t of taskRows ?? []) {
      if (t.goal_series_id) counts.set(t.goal_series_id, (counts.get(t.goal_series_id) ?? 0) + 1)
    }
    setTaskCounts(counts)

    // All four horizons at their current period — the screen shows every one at once.
    const currentStart = Object.fromEntries(PERIOD_TYPES.map((p) => [p, periodStartISO(p)])) as Record<PeriodType, string>
    const current = all.filter((g) => g.period_start === currentStart[g.period_type])

    const resolved = await Promise.all(
      current.map(async (goal) => {
        const { progress, isRollup } = await resolveGoalProgress(goal)
        const pace = goalPace(goal, progress)
        const done = isGoalDone(goal, progress, isRollup)
        return { goal, progress, isRollup, pace, done, offPace: isOffPace(pace, done) }
      }),
    )
    setRows(resolved)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  // Parent options follow the period picked in the form, not a page-level period any more.
  useEffect(() => {
    if (!formParentPeriod) {
      setParentOptions([])
      return
    }
    const start = periodStartISO(formParentPeriod)
    supabase
      .from('goals')
      .select('*')
      .eq('period_type', formParentPeriod)
      .eq('period_start', start)
      .order('created_at')
      .then(({ data }) => setParentOptions((data ?? []) as Goal[]))
  }, [formParentPeriod])

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
      period_type: formPeriod,
      period_start: periodStartISO(formPeriod),
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

  const visible = rows.filter((r) => (filter === 'all' ? true : filter === 'done' ? r.done : r.offPace))
  const doneCount = rows.filter((r) => r.done).length
  const offPaceCount = rows.filter((r) => r.offPace).length
  // "At or ahead of pace" counts only goals that can have a verdict at all.
  const paced = rows.filter((r) => r.pace.delta != null && r.pace.started)
  const atOrAhead = paced.filter((r) => r.pace.onPace || (r.pace.delta ?? 0) >= 0).length

  const hero = (
    <>
      <div className="mt-4 flex gap-1.5 rounded-[18px] bg-white/14 p-[5px]">
        {(
          [
            { id: 'all' as const, label: `All ${rows.length}` },
            { id: 'offPace' as const, label: `Off pace ${offPaceCount}` },
            { id: 'done' as const, label: `Done ${doneCount}` },
          ] satisfies { id: GoalFilter; label: string }[]
        ).map((option) => (
          <button
            key={option.id}
            onClick={() => setFilter(option.id)}
            className={`flex-1 rounded-[14px] py-2 text-xs transition ${
              filter === option.id ? 'bg-surface font-semibold text-pine-dark' : 'font-medium text-white'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {!loading && paced.length > 0 && (
        <div className="mt-3.5 flex flex-col gap-[5px]">
          <span className="text-sm font-medium leading-snug text-white">
            {atOrAhead} of {paced.length} goal{paced.length === 1 ? '' : 's'}{' '}
            {atOrAhead === 1 && paced.length === 1 ? 'is' : 'are'} at or ahead of pace.
          </span>
          <PaceLegend />
        </div>
      )}
    </>
  )

  return (
    <Screen title="Goals" onRefresh={load} hero={hero}>
      {loading ? (
        <p className="text-sm text-ink-disabled">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-disabled">No goals yet — add one below.</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-ink-disabled">
          {filter === 'offPace' ? 'Nothing is behind pace right now.' : 'Nothing finished yet this period.'}
        </p>
      ) : (
        SECTION_ORDER.map((periodType) => {
          const section = visible.filter((r) => r.goal.period_type === periodType)
          if (section.length === 0) return null
          // Every goal in a section shares a period, so any of them can say how long is left.
          const daysLeft = section[0].pace.daysLeft
          const sectionOffPace = section.filter((r) => r.offPace).length
          const countLine = [
            `${section.length} goal${section.length === 1 ? '' : 's'}`,
            `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`,
            sectionOffPace > 0 ? `${sectionOffPace} off pace` : null,
          ]
            .filter(Boolean)
            .join(' · ')

          return (
            <div key={periodType} className="flex flex-col gap-[9px]">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold tracking-[0.1em] text-ink-3">
                  {sectionHeading(periodType, section[0].goal.period_start)}
                </span>
                <span className="text-[11px] font-medium text-ink-disabled">{countLine}</span>
                <span className="h-px flex-1 bg-line-strong" />
              </div>

              {section.map(({ goal, progress, isRollup, pace, done }) => {
                const style = goalHue(goal, done, isRollup)
                const pct = goal.target_value ? Math.min(100, (progress / goal.target_value) * 100) : 0
                const metricInfo = isGoalMetric(goal.auto_metric) ? goalMetricInfo(goal.auto_metric) : null
                const verdict = paceVerdict(goal, pace)
                const parent = goal.parent_series_id ? goalsBySeries.get(goal.parent_series_id) : undefined
                const tasks = taskCounts.get(goal.series_id) ?? 0
                const feeds = childCounts.get(goal.series_id) ?? 0
                // What drives the goal, then what it connects to — one quiet line rather
                // than the row of badges this card used to carry.
                const footer = [
                  metricInfo ? `${metricInfo.icon} auto` : isRollup ? '🔗 from sub-goals' : 'manual',
                  tasks > 0 ? `${tasks} daily task${tasks === 1 ? '' : 's'}` : null,
                  parent ? `→ ${parent.title}` : feeds > 0 ? `feeds ${feeds} goal${feeds === 1 ? '' : 's'}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')

                return (
                  <button
                    key={goal.id}
                    onClick={() => openGoalDetail(goal.id)}
                    className="flex overflow-hidden rounded-[20px] border border-line bg-surface text-left shadow-card"
                  >
                    <span className="w-[5px] shrink-0 self-stretch" style={{ background: style.accent }} />
                    <div className="min-w-0 flex-1 px-[15px] py-[13px]">
                      <div className="flex items-start justify-between gap-2.5">
                        <p className={`min-w-0 text-[15px] font-semibold ${done ? 'text-ink-disabled line-through' : 'text-ink'}`}>
                          {goal.title}
                        </p>
                        {goal.target_value != null && (
                          <span className="shrink-0 text-base font-semibold" style={{ color: style.ink }}>
                            {Math.round(pct)}%
                          </span>
                        )}
                      </div>

                      {goal.target_value != null ? (
                        <div className="mt-2.5 flex items-center gap-3">
                          <DaysRing pace={pace} />
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-xs font-medium text-ink-2">
                                {Math.round(progress).toLocaleString()} / {goal.target_value.toLocaleString()}
                                {metricInfo ? ` ${metricInfo.unit}` : ''}
                              </span>
                              {pace.expected != null && (
                                <span className="shrink-0 text-[10px] font-medium text-ink-muted">
                                  pace {Math.round(pace.expected).toLocaleString()}
                                </span>
                              )}
                            </div>
                            <PaceBars progressPct={pct} pacePct={pace.elapsedFraction * 100} accent={style.accent} />
                          </div>
                        </div>
                      ) : (
                        // No target means no pace to show — it falls back to the plain
                        // done/active treatment rather than inventing a number.
                        <p className="mt-1.5 text-xs font-medium text-ink-muted">
                          {done ? 'Done' : 'No target — tracked as done or not done'}
                        </p>
                      )}

                      <div className="mt-[9px] flex flex-wrap items-center gap-[7px]">
                        {verdict && <VerdictChip label={verdict.label} tone={verdict.tone} />}
                        <span className="text-[10px] font-medium text-ink-muted">{footer}</span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )
        })
      )}

      <form onSubmit={addGoal} className="mt-1 flex flex-col gap-2.5">
        <div className="flex gap-2.5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`New ${PERIOD_LABELS[formPeriod].toLowerCase()} goal`}
            className="min-w-0 flex-1 rounded-[20px] border border-line bg-surface px-4 py-3 text-sm text-ink placeholder-ink-disabled outline-none focus:border-pine"
          />
          <button type="submit" className="shrink-0 rounded-[20px] bg-pine px-5 py-3 text-sm font-semibold text-white">
            Add
          </button>
        </div>
        <select
          value={formPeriod}
          onChange={(e) => {
            setFormPeriod(e.target.value as PeriodType)
            setParentSeriesId('')
          }}
          aria-label="Goal period"
          className="rounded-[20px] border border-line bg-surface px-4 py-3 text-sm text-ink outline-none focus:border-pine"
        >
          {PERIOD_TYPES.map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABELS[p]} goal
            </option>
          ))}
        </select>
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
          <optgroup label="Track Strava workouts">
            {SESSION_METRICS.map((m) => (
              <option key={m} value={m}>
                Auto-track {SESSION_METRIC_INFO[m].label}
              </option>
            ))}
          </optgroup>
        </select>
        {formParentPeriod && (
          <select
            value={parentSeriesId}
            onChange={(e) => setParentSeriesId(e.target.value)}
            className="rounded-[20px] border border-line bg-surface px-4 py-3 text-sm text-ink outline-none focus:border-pine"
          >
            <option value="">No parent goal</option>
            {parentOptions.map((g) => (
              <option key={g.id} value={g.series_id}>
                Roll up into: {g.title} ({PERIOD_LABELS[formParentPeriod]})
              </option>
            ))}
          </select>
        )}
        {!autoMetric && (
          <label className="flex items-center gap-2 text-sm text-ink-3">
            <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="accent-pine" />
            Recurring every {PERIOD_LABELS[formPeriod].toLowerCase().replace('ly', '')}
          </label>
        )}
      </form>
    </Screen>
  )
}
