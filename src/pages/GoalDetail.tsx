import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { PERIOD_LABELS, periodEndISO, weekStartISO } from '../lib/dates'
import {
  FINANCE_METRICS,
  SESSION_METRICS,
  goalIntervalTotals,
  goalMetricInfo,
  goalPace,
  goalSource,
  goalStyle,
  isGoalDone,
  isGoalMetric,
  loadMilestoneResults,
  paceVerdict,
  resolveGoalProgress,
  SUB_INTERVAL_HEADING,
  type GoalPace,
  type IntervalBucket,
} from '../lib/goals'
import { CATEGORY_STYLES } from '../lib/categories'
import { AUTO_METRICS } from '../lib/metrics'
import { formatGoalValue, milestoneState, parseGoalValue, type MilestoneResult } from '../lib/checkins'
import { useNav } from '../contexts/NavContext'
import { Screen } from '../components/Screen'
import { DaysRing, PaceBars } from '../components/Pace'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { Category, CheckinRating, DailyTask, Goal, GoalCheckin } from '../lib/types'

const RATING_LABEL: Record<CheckinRating, string> = {
  on_track: 'On track',
  slipping: 'Slipping',
  stuck: 'Stuck',
  done: 'Done',
  partly: 'Partly',
  missed: 'Missed',
}
const RATING_FILL: Partial<Record<CheckinRating, string>> = { on_track: '#1f6b5c', slipping: '#8a6321', stuck: '#a33327' }

/**
 * The nudge after the projection sentence. Deliberately a lookup, not generated prose:
 * a metric with no copy here gets no second clause rather than a sentence that sounds
 * confident about something the app can't actually suggest.
 */
const NUDGE: Record<string, string> = {
  strength_sessions: 'One more session a week closes the gap.',
  cardio_sessions: 'One more session a week closes the gap.',
  cardio_minutes: 'One extra session a week closes most of the gap.',
  strength_minutes: 'A longer session each week closes most of the gap.',
  steps: 'A single longer walk most days covers it.',
}

interface TaskRow {
  task: DailyTask
  /** Mon–Sun: whether the task was completed on that day of the current week. */
  week: boolean[]
  doneCount: number
}

export function GoalDetail({ goalId, onBack }: { goalId: string; onBack: () => void }) {
  const { openGoalDetail } = useNav()
  const [goal, setGoal] = useState<Goal | null>(null)
  const [progress, setProgress] = useState(0)
  const [isRollup, setIsRollup] = useState(false)
  const [ancestors, setAncestors] = useState<{ goal: Goal; progress: number; pace: GoalPace }[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [buckets, setBuckets] = useState<IntervalBucket[]>([])
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addingTask, setAddingTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [categories, setCategories] = useState<Map<string, Category>>(new Map())
  const [checkinList, setCheckinList] = useState<GoalCheckin[]>([])
  const [results, setResults] = useState<MilestoneResult[]>([])
  const [resultDate, setResultDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [resultValue, setResultValue] = useState('')
  const [editTarget, setEditTarget] = useState('')
  const [editMetric, setEditMetric] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('goals').select('*').eq('id', goalId).maybeSingle()
    const loaded = (data ?? null) as Goal | null
    setGoal(loaded)
    if (!loaded) {
      setLoading(false)
      return
    }

    const weekStart = weekStartISO()
    const weekEnd = periodEndISO('week', weekStart)
    const milestone = loaded.kind === 'milestone'
    const [resolved, intervals, { data: taskRows }, { data: parentRows }, { data: catRows }, milestoneResults] = await Promise.all([
      resolveGoalProgress(loaded),
      // Milestone and do-it goals have nothing to split into sub-intervals.
      loaded.kind === 'number' ? goalIntervalTotals(loaded) : Promise.resolve([]),
      supabase.from('daily_tasks').select('*').eq('active', true).eq('goal_series_id', loaded.series_id).order('created_at'),
      supabase.from('goals').select('*'),
      supabase.from('categories').select('*').order('name'),
      milestone ? loadMilestoneResults(loaded) : Promise.resolve([]),
    ])
    setProgress(resolved.progress)
    setIsRollup(resolved.isRollup)
    setBuckets(intervals)
    setCategories(new Map(((catRows ?? []) as Category[]).map((c) => [c.id, c])))
    setResults(milestoneResults.filter((r) => r.date >= loaded.period_start).sort((a, b) => b.date.localeCompare(a.date)))
    // Check-ins for every instance of this series (a year goal is one row; a weekly one many).
    const seriesIds = ((parentRows ?? []) as Goal[]).filter((g) => g.series_id === loaded.series_id).map((g) => g.id)
    const { data: checkinRows } = await supabase.from('goal_checkins').select('*').in('goal_id', seriesIds).order('period_start', { ascending: false })
    setCheckinList((checkinRows ?? []) as GoalCheckin[])

    // The rollup chain upward. Walks parent_series_id, taking whichever instance of that
    // series contains this goal's period — the same containment rule the progress rollup
    // uses, so the chain can't disagree with the numbers it shows.
    const all = (parentRows ?? []) as Goal[]
    const chain: { goal: Goal; progress: number; pace: GoalPace }[] = []
    let cursor: Goal | null = loaded
    const seen = new Set<string>([loaded.series_id])
    while (cursor?.parent_series_id) {
      const parentSeries: string = cursor.parent_series_id
      if (seen.has(parentSeries)) break // a cycle would otherwise hang the loop
      seen.add(parentSeries)
      const child: Goal = cursor
      const parent =
        all.find(
          (g) =>
            g.series_id === parentSeries &&
            g.period_start <= child.period_start &&
            periodEndISO(g.period_type, g.period_start) >= child.period_start,
        ) ?? null
      if (!parent) break
      const parentResolved = await resolveGoalProgress(parent)
      chain.push({ goal: parent, progress: parentResolved.progress, pace: goalPace(parent, parentResolved.progress) })
      cursor = parent
    }
    setAncestors(chain)

    const taskList = (taskRows ?? []) as DailyTask[]
    if (taskList.length > 0) {
      const { data: completions } = await supabase
        .from('task_completions')
        .select('task_id, date')
        .gte('date', weekStart)
        .lte('date', weekEnd)
        .in(
          'task_id',
          taskList.map((t) => t.id),
        )
      const weekDays = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart + 'T00:00:00')
        d.setDate(d.getDate() + i)
        return format(d, 'yyyy-MM-dd')
      })
      setTasks(
        taskList.map((task) => {
          const dates = new Set((completions ?? []).filter((c) => c.task_id === task.id).map((c) => c.date))
          const week = weekDays.map((d) => dates.has(d))
          return { task, week, doneCount: week.filter(Boolean).length }
        }),
      )
    } else {
      setTasks([])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId])

  async function addTask(e: React.FormEvent) {
    e.preventDefault()
    if (!goal || !newTaskTitle.trim()) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('daily_tasks').insert({
      user_id: user.id,
      title: newTaskTitle.trim(),
      active: true,
      recurring: true,
      goal_series_id: goal.series_id,
    })
    setNewTaskTitle('')
    setAddingTask(false)
    load()
  }

  async function toggleDone() {
    if (!goal) return
    setMenuOpen(false)
    const next = goal.status === 'done' ? 'active' : 'done'
    setGoal({ ...goal, status: next })
    await supabase.from('goals').update({ status: next }).eq('id', goal.id)
  }

  async function bump(delta: number) {
    if (!goal) return
    const next = Math.max(0, goal.progress + delta)
    const status = goal.target_value && next >= goal.target_value ? 'done' : 'active'
    setGoal({ ...goal, progress: next, status })
    setProgress(next)
    await supabase.from('goals').update({ progress: next, status }).eq('id', goal.id)
  }

  async function saveTargetSource(e: React.FormEvent) {
    e.preventDefault()
    if (!goal) return
    const target_value = editTarget.trim() ? parseGoalValue(editTarget, false) : null
    const auto_metric = editMetric || null
    setMenuOpen(false)
    await supabase.from('goals').update({ target_value, auto_metric }).eq('id', goal.id)
    load()
  }

  async function setLabel(categoryId: string | null) {
    if (!goal) return
    setMenuOpen(false)
    setGoal({ ...goal, category_id: categoryId })
    await supabase.from('goals').update({ category_id: categoryId }).eq('id', goal.id)
  }

  async function logResult(e: React.FormEvent) {
    e.preventDefault()
    if (!goal) return
    const value = parseGoalValue(resultValue, goal.lower_is_better)
    if (value == null) return
    await supabase.from('goal_results').insert({ goal_id: goal.id, date: resultDate, value })
    setResultValue('')
    load()
  }

  async function remove() {
    if (!goal) return
    setConfirmDelete(false)
    await supabase.from('goals').delete().eq('id', goal.id)
    onBack()
  }

  if (loading && !goal) {
    return (
      <Screen title="Goal" onBack={onBack}>
        <p className="text-sm text-ink-disabled">Loading…</p>
      </Screen>
    )
  }

  if (!goal) {
    return (
      <Screen title="Goal" onBack={onBack}>
        <p className="text-sm text-ink-disabled">That goal no longer exists.</p>
      </Screen>
    )
  }

  const pace = goalPace(goal, progress)
  const milestone = goal.kind === 'milestone' ? milestoneState(goal, results, goal.period_start) : null
  const isNumber = goal.kind === 'number'
  const done = goal.kind === 'done' ? goal.status === 'done' : milestone ? milestone.toGo === 0 : isGoalDone(goal, progress, isRollup)
  const style = goalStyle(goal, categories)
  const metricInfo = isGoalMetric(goal.auto_metric) ? goalMetricInfo(goal.auto_metric) : null
  const unit = metricInfo ? ` ${metricInfo.unit}` : ''
  const pct = goal.target_value ? Math.min(100, (progress / goal.target_value) * 100) : 0
  const verdict = paceVerdict(goal, pace)
  const ahead = (pace.delta ?? 0) >= 0
  const periodLabel = PERIOD_LABELS[goal.period_type].replace('ly', '')
  const isManualBumpable = isNumber && !metricInfo && !isRollup
  const isLongTerm = goal.period_type === 'year' || goal.period_type === 'quarter'
  const labelName = goal.category_id ? categories.get(goal.category_id)?.name : null
  const v = (n: number) => formatGoalValue(goal, n)

  const hero = (
    <>
      <span className="mt-3.5 inline-block rounded-full bg-white/16 px-[11px] py-[5px] text-[11px] font-semibold text-white">
        {labelName ? `${labelName} · ` : ''}
        {goal.kind === 'done' ? 'do it' : isRollup && isNumber ? '🔗 from sub-goals' : goalSource(goal)} · {periodLabel}
        {goal.recurring ? ' · recurring' : ''}
      </span>
      {milestone && (
        <div className="mt-4 flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[17px] font-semibold text-white">{milestone.best ? `Best ${v(milestone.best.value)}` : 'No result yet'}</span>
            {goal.target_value != null && <span className="text-[11px] font-medium text-white/70">target {v(goal.target_value)}</span>}
          </div>
          {milestone.basePct + milestone.gainPct > 0 && (
            <span className="relative block h-2 overflow-hidden rounded-full bg-white/20">
              <span className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${milestone.basePct + milestone.gainPct}%` }} />
            </span>
          )}
          <span className="text-[11px] font-medium text-white/80">
            {[goal.start_value != null ? `From ${v(goal.start_value)}` : null, milestone.toGo != null ? (milestone.toGo ? `${v(milestone.toGo)} to go` : 'Target hit') : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      )}
      {goal.kind === 'done' && (
        <button
          onClick={toggleDone}
          className={`mt-4 rounded-2xl px-4 py-2.5 text-sm font-semibold ${done ? 'bg-white/16 text-white' : 'bg-surface text-pine-dark'}`}
        >
          {done ? 'Done ✓ · tap to undo' : 'Mark as done'}
        </button>
      )}
      {isNumber && goal.target_value != null && (
        <div className="mt-4 flex items-center gap-4">
          <DaysRing pace={pace} variant="hero" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[17px] font-semibold text-white">
                {Math.round(progress).toLocaleString()}
                {unit}
              </span>
              <span className="text-[11px] font-medium text-white/70">of {goal.target_value.toLocaleString()}</span>
            </div>
            <PaceBars progressPct={pct} pacePct={pace.elapsedFraction * 100} accent={style.accent} variant="hero" />
            {pace.expected != null && verdict && (
              <span className="text-[11px] font-medium text-white/80">
                {verdict.tone === 'onPace'
                  ? `Pace says ${Math.round(pace.expected).toLocaleString()}${unit} — you're on pace`
                  : `Pace says ${Math.round(pace.expected).toLocaleString()}${unit} — you're ${verdict.label}`}
              </span>
            )}
          </div>
        </div>
      )}
    </>
  )

  return (
    <Screen title={goal.title} subtitle={`${periodLabel} · ${pace.daysLeft} days left`} onBack={onBack} hero={hero}>
      {/* Actions the list view used to carry inline. */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-ink-muted">
          {format(new Date(goal.period_start + 'T00:00:00'), 'd MMM')} –{' '}
          {format(new Date(periodEndISO(goal.period_type, goal.period_start) + 'T00:00:00'), 'd MMM')}
        </span>
        <span className="flex items-center gap-1.5">
          {isManualBumpable && goal.target_value != null && (
            <>
              <button onClick={() => bump(-1)} className="h-[30px] w-[30px] rounded-full bg-track font-semibold text-ink-3">
                −
              </button>
              <button
                onClick={() => bump(1)}
                className="h-[30px] w-[30px] rounded-full font-semibold text-white"
                style={{ background: style.check }}
              >
                +
              </button>
            </>
          )}
          <button
            onClick={() => {
              // Seed the target/source editor with what the goal has now.
              setEditTarget(goal.target_value != null ? String(goal.target_value) : '')
              setEditMetric(goal.auto_metric ?? '')
              setMenuOpen((v) => !v)
            }}
            aria-label="Goal actions"
            className="h-[30px] rounded-[14px] bg-track px-3 text-xs font-semibold text-ink-3"
          >
            ⋯
          </button>
        </span>
      </div>

      {menuOpen && (
        <div className="flex flex-col gap-1 rounded-[18px] border border-line bg-surface p-1.5 shadow-card">
          <div className="flex flex-wrap gap-1.5 px-2 py-2">
            {[{ id: null as string | null, name: 'No label', color: 'violet' as const }, ...categories.values()].map((c) => (
              <button
                key={c.id ?? 'none'}
                onClick={() => setLabel(c.id)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${goal.category_id === c.id ? 'bg-pine font-semibold text-white' : 'border border-line font-medium text-ink-2'}`}
              >
                {c.id && <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_STYLES[c.color].accent }} />}
                {c.name}
              </button>
            ))}
          </div>
          {/* Target + source, editable after the fact (a target typed into the title, a goal
              created before its data source existed). Number goals only. */}
          {isNumber && (
            <form onSubmit={saveTargetSource} className="flex flex-col gap-2 border-t border-line px-2 pt-2.5 pb-1">
              <label className="flex items-center justify-between gap-3">
                <span className="shrink-0 text-xs font-medium text-ink-3">Target</span>
                <input
                  value={editTarget}
                  onChange={(e) => setEditTarget(e.target.value)}
                  inputMode="decimal"
                  placeholder="none = done or not"
                  className="min-w-0 flex-1 rounded-xl border border-line bg-page px-3 py-1.5 text-right text-sm text-ink outline-none focus:border-pine"
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="shrink-0 text-xs font-medium text-ink-3">Track from</span>
                <select
                  value={editMetric}
                  onChange={(e) => setEditMetric(e.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-line bg-page px-3 py-1.5 text-right text-sm text-ink outline-none focus:border-pine"
                >
                  <option value="">Manual</option>
                  {[...AUTO_METRICS, ...SESSION_METRICS, ...FINANCE_METRICS].map((m) => (
                    <option key={m} value={m}>
                      {goalMetricInfo(m).icon} {goalMetricInfo(m).label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="self-end rounded-full bg-pine px-3.5 py-1.5 text-xs font-semibold text-white">
                Save
              </button>
            </form>
          )}
          {isNumber && goal.target_value == null && (
            <button onClick={toggleDone} className="rounded-[14px] px-3 py-2.5 text-left text-sm font-medium text-ink-2">
              {goal.status === 'done' ? 'Mark as active' : 'Mark as done'}
            </button>
          )}
          <button
            onClick={() => {
              setMenuOpen(false)
              setConfirmDelete(true)
            }}
            className="rounded-[14px] px-3 py-2.5 text-left text-sm font-medium text-cat-rose-ink"
          >
            Delete goal
          </button>
        </div>
      )}

      {/* Milestone results: read from the gym log, or logged here by hand. */}
      {milestone && (
        <div className="flex flex-col gap-[9px]">
          <p className="text-[11px] font-semibold tracking-[0.1em] text-ink-3">RESULTS</p>
          {!goal.source_exercise && (
            <form onSubmit={logResult} className="flex gap-2">
              <input
                type="date"
                value={resultDate}
                onChange={(e) => setResultDate(e.target.value)}
                className="rounded-[18px] border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-pine"
              />
              <input
                value={resultValue}
                onChange={(e) => setResultValue(e.target.value)}
                inputMode={goal.lower_is_better ? 'text' : 'decimal'}
                placeholder={goal.lower_is_better ? '3:14:20' : 'Result'}
                className="min-w-0 flex-1 rounded-[18px] border border-line bg-surface px-4 py-2.5 text-sm text-ink placeholder-ink-disabled outline-none focus:border-pine"
              />
              <button type="submit" className="shrink-0 rounded-[18px] bg-pine px-4 py-2.5 text-sm font-semibold text-white">
                Log
              </button>
            </form>
          )}
          <div className="overflow-hidden rounded-[18px] border border-line bg-surface">
            {results.length === 0 ? (
              <p className="px-[15px] py-3 text-[13px] text-ink-disabled">
                {goal.source_exercise ? `No ${goal.source_exercise} sets with a weight logged this ${periodLabel.toLowerCase()} yet.` : 'Nothing logged yet.'}
              </p>
            ) : (
              results.slice(0, 12).map((r, i) => (
                <div key={`${r.date}-${i}`} className={`flex items-center justify-between px-[15px] py-2.5 text-[13px] ${i > 0 ? 'border-t border-line' : ''}`}>
                  <span className="text-ink-3">{format(new Date(r.date + 'T00:00:00'), 'd MMM')}</span>
                  <span className="font-semibold" style={{ color: r === milestone.best ? style.ink : undefined }}>
                    {v(r.value)}
                    {r.reps ? ` × ${r.reps}` : ''}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Long-term check-ins, newest first. */}
      {isLongTerm && checkinList.length > 0 && (
        <div className="flex flex-col gap-[9px]">
          <p className="text-[11px] font-semibold tracking-[0.1em] text-ink-3">CHECK-INS</p>
          <div className="overflow-hidden rounded-[18px] border border-line bg-surface">
            {checkinList.map((c, i) => (
              <div key={c.id} className={`flex flex-col gap-1 px-[15px] py-3 ${i > 0 ? 'border-t border-line' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-ink">{format(new Date(c.period_start + 'T00:00:00'), 'MMMM')}</span>
                  {c.rating ? (
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: RATING_FILL[c.rating] ?? style.ink }}>
                      {RATING_LABEL[c.rating]}
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium text-ink-muted">skipped</span>
                  )}
                </div>
                {c.note && <p className="text-xs leading-relaxed text-ink-2">{c.note}</p>}
                {c.focus && <p className="text-[11px] font-medium text-ink-muted">Focus: {c.focus}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 1 · TO FINISH ON TIME */}
      {isNumber && goal.target_value != null && pace.perDayNeeded != null && (
        <div className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-surface px-4 py-[15px] shadow-card">
          <p className="text-xs font-semibold tracking-[0.06em] text-ink-3">TO FINISH ON TIME</p>
          <div className="flex gap-2.5">
            <div className="flex-1 rounded-[14px] px-3 py-[11px]" style={{ background: style.tint }}>
              <span className="block text-[19px] font-semibold" style={{ color: style.ink }}>
                {pace.perDayNeeded.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </span>
              <span className="mt-0.5 block text-[10px] font-medium" style={{ color: style.ink }}>
                {pace.daysLeft === 0 ? 'left today' : `${metricInfo ? metricInfo.unit : ''}/day needed`.trim()}
              </span>
            </div>
            <div className="flex-1 rounded-[14px] bg-track px-3 py-[11px]">
              <span className="block text-[19px] font-semibold text-ink-2">
                {pace.perDayActual.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </span>
              <span className="mt-0.5 block text-[10px] font-medium text-ink-2">your average so far</span>
            </div>
          </div>
          {pace.projected != null && (
            <p className="text-xs font-medium leading-relaxed text-ink-2">
              {ahead ? (
                <>
                  At your current rate you&apos;ll land on{' '}
                  <strong className="font-semibold" style={{ color: style.ink }}>
                    {Math.round(pace.projected).toLocaleString()}
                    {unit}
                  </strong>
                  .
                </>
              ) : (
                <>
                  At your current rate you&apos;ll land on{' '}
                  <strong className="font-semibold">
                    {Math.round(pace.projected).toLocaleString()}
                    {unit}
                  </strong>
                  .{goal.auto_metric && NUDGE[goal.auto_metric] ? ` ${NUDGE[goal.auto_metric]}` : ''}
                </>
              )}
            </p>
          )}
        </div>
      )}

      {/* 2 · ROLLS UP INTO */}
      {ancestors.length > 0 && (
        <div className="flex flex-col gap-[9px]">
          <p className="text-[11px] font-semibold tracking-[0.1em] text-ink-3">ROLLS UP INTO</p>
          {ancestors.map(({ goal: parent, progress: parentProgress, pace: parentPace }) => {
            const parentVerdict = paceVerdict(parent, parentPace)
            const parentStyle = goalStyle(parent, categories)
            const parentPct = parent.target_value ? Math.min(100, (parentProgress / parent.target_value) * 100) : 0
            const parentUnit = isGoalMetric(parent.auto_metric) ? ` ${goalMetricInfo(parent.auto_metric).unit}` : ''
            return (
              <button
                key={parent.id}
                onClick={() => openGoalDetail(parent.id)}
                className="flex items-center gap-3 rounded-[18px] border border-line bg-surface px-[15px] py-3 text-left"
              >
                <span className="w-1 self-stretch rounded-full" style={{ background: parentStyle.accent }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-ink">{parent.title}</p>
                  <p className="mt-[3px] truncate text-[10px] font-medium text-ink-muted">
                    {PERIOD_LABELS[parent.period_type].replace('ly', '')} · {Math.round(parentProgress).toLocaleString()}
                    {parentUnit}
                    {parentVerdict ? ` · ${parentVerdict.label}` : ''}
                  </p>
                </div>
                {parent.target_value != null && (
                  <span className="shrink-0 text-sm font-semibold" style={{ color: parentStyle.ink }}>
                    {Math.round(parentPct)}%
                  </span>
                )}
                <span className="shrink-0 text-[15px] text-ink-faint">›</span>
              </button>
            )
          })}
        </div>
      )}

      {/* 3 · DAILY TASKS FEEDING THIS */}
      <div className="flex flex-col gap-[9px]">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold tracking-[0.1em] text-ink-3">DAILY TASKS FEEDING THIS</p>
          <button onClick={() => setAddingTask((v) => !v)} className="text-[11px] font-semibold text-pine">
            {addingTask ? 'Cancel' : '+ Add'}
          </button>
        </div>
        {addingTask && (
          <form onSubmit={addTask} className="flex gap-2">
            <input
              autoFocus
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="New daily task"
              className="min-w-0 flex-1 rounded-[18px] border border-line bg-surface px-4 py-2.5 text-sm text-ink placeholder-ink-disabled outline-none focus:border-pine"
            />
            <button type="submit" className="shrink-0 rounded-[18px] bg-pine px-4 py-2.5 text-sm font-semibold text-white">
              Add
            </button>
          </form>
        )}
        <div className="overflow-hidden rounded-[18px] border border-line bg-surface">
          {tasks.length === 0 ? (
            <p className="px-[15px] py-3 text-[13px] text-ink-disabled">No daily tasks feed this goal yet.</p>
          ) : (
            tasks.map(({ task, week, doneCount }, i) => (
              <div key={task.id}>
                {i > 0 && <span className="block h-px bg-line" />}
                <div className="flex items-center gap-3 px-[15px] py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink">{task.title}</p>
                    <div className="mt-1.5 flex gap-1">
                      {week.map((hit, day) => (
                        <span
                          key={day}
                          className="block h-1.5 w-3.5 rounded-full"
                          style={{ background: hit ? style.accent : '#ece5d7' }}
                        />
                      ))}
                    </div>
                  </div>
                  <span className="shrink-0 text-right">
                    <span className="block text-[13px] font-semibold" style={{ color: style.ink }}>
                      {doneCount} / 7
                    </span>
                    <span className="block text-[9px] font-medium text-ink-muted">this week</span>
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 4 · The only history shown, and all of it inside the current period. */}
      {buckets.length > 0 && (
        <div className="flex flex-col gap-[9px]">
          <p className="text-[11px] font-semibold tracking-[0.1em] text-ink-3">{SUB_INTERVAL_HEADING[goal.period_type]}</p>
          <div className="flex h-[72px] items-end gap-[5px] rounded-[18px] border border-line bg-surface px-[15px] py-3.5">
            {(() => {
              const max = Math.max(...buckets.map((b) => b.value), 1)
              return buckets.map((bucket) => (
                <span
                  key={bucket.start}
                  title={`${format(new Date(bucket.start + 'T00:00:00'), 'd MMM')}: ${Math.round(bucket.value).toLocaleString()}`}
                  className="min-h-[4px] flex-1 rounded"
                  style={{
                    height: bucket.state === 'future' ? 4 : `${Math.max((bucket.value / max) * 100, 4)}%`,
                    background: bucket.state === 'future' ? '#ece5d7' : style.accent,
                    // The interval in progress is faded: it isn't a short bar, it's unfinished.
                    opacity: bucket.state === 'current' ? 0.45 : 1,
                  }}
                />
              ))
            })()}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${goal.title}"?`}
        message="The goal and its progress are removed. Daily tasks that fed it stay, but stop being attributed."
        confirmLabel="Delete"
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </Screen>
  )
}
