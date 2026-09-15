import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { PERIOD_LABELS, periodEndISO, weekStartISO } from '../lib/dates'
import {
  goalIntervalTotals,
  goalMetricInfo,
  goalPace,
  isGoalDone,
  isGoalMetric,
  paceVerdict,
  resolveGoalProgress,
  SUB_INTERVAL_HEADING,
  type GoalPace,
  type IntervalBucket,
} from '../lib/goals'
import { CATEGORY_STYLES } from '../lib/categories'
import { useNav } from '../contexts/NavContext'
import { Screen } from '../components/Screen'
import { DaysRing, PaceBars } from '../components/Pace'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { DailyTask, Goal } from '../lib/types'

function goalHue(goal: Goal, done: boolean, isRollup: boolean) {
  if (done || goal.auto_metric === 'sleep_hours') return CATEGORY_STYLES.emerald
  if (isGoalMetric(goal.auto_metric)) return CATEGORY_STYLES.pink
  if (isRollup) return CATEGORY_STYLES.sky
  return CATEGORY_STYLES.violet
}

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
    const [resolved, intervals, { data: taskRows }, { data: parentRows }] = await Promise.all([
      resolveGoalProgress(loaded),
      goalIntervalTotals(loaded),
      supabase.from('daily_tasks').select('*').eq('active', true).eq('goal_series_id', loaded.series_id).order('created_at'),
      supabase.from('goals').select('*'),
    ])
    setProgress(resolved.progress)
    setIsRollup(resolved.isRollup)
    setBuckets(intervals)

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
  const done = isGoalDone(goal, progress, isRollup)
  const style = goalHue(goal, done, isRollup)
  const metricInfo = isGoalMetric(goal.auto_metric) ? goalMetricInfo(goal.auto_metric) : null
  const unit = metricInfo ? ` ${metricInfo.unit}` : ''
  const pct = goal.target_value ? Math.min(100, (progress / goal.target_value) * 100) : 0
  const verdict = paceVerdict(goal, pace)
  const ahead = (pace.delta ?? 0) >= 0
  const periodLabel = PERIOD_LABELS[goal.period_type].replace('ly', '')
  const isManualBumpable = !metricInfo && !isRollup

  const hero = (
    <>
      <span className="mt-3.5 inline-block rounded-full bg-white/16 px-[11px] py-[5px] text-[11px] font-semibold text-white">
        {metricInfo ? `${metricInfo.icon} auto` : isRollup ? '🔗 from sub-goals' : 'manual'} · {periodLabel}
        {goal.recurring ? ' · recurring' : ''}
      </span>
      {goal.target_value != null && (
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
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Goal actions"
            className="h-[30px] rounded-[14px] bg-track px-3 text-xs font-semibold text-ink-3"
          >
            ⋯
          </button>
        </span>
      </div>

      {menuOpen && (
        <div className="flex flex-col gap-1 rounded-[18px] border border-line bg-surface p-1.5 shadow-card">
          {goal.target_value == null && (
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

      {/* 1 · TO FINISH ON TIME */}
      {goal.target_value != null && pace.perDayNeeded != null && (
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
            const parentStyle = goalHue(parent, isGoalDone(parent, parentProgress, true), true)
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
