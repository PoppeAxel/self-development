import { useEffect, useState } from 'react'
import { format, addDays, subDays, getDay } from 'date-fns'
import { supabase } from '../lib/supabase'
import { todayISO, weekStartISO, localTimeToUTC, utcTimeToLocal, DAY_LABELS } from '../lib/dates'
import { rolloverRecurringGoals } from '../lib/goals'
import { ensureDefaultCategories, CATEGORY_STYLES } from '../lib/categories'
import { AUTO_METRICS, METRIC_INFO, isAutoMetric, upsertMetricValue, type AutoMetric } from '../lib/metrics'
import { addMacros, logEntryMacros, ZERO_MACROS } from '../lib/food'
import { THEME } from '../lib/theme'
import { ProgressRing } from '../components/ProgressRing'
import { Screen, HeroChip } from '../components/Screen'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { MorningCheckIn } from '../components/MorningCheckIn'
import type { Category, DailyTask, Goal, Reminder, RecipeIngredient } from '../lib/types'

// A task whose auto_metric is this sentinel auto-completes off today's Food-log total
// instead of a synced journal metric — and unlike every other auto_metric (which only
// grows toward a floor), it's a ceiling: done means "at or under budget," so it can
// un-complete itself later in the day if more food gets logged and the total goes over.
const CALORIE_BUDGET_METRIC = 'calorie_budget'

export function Today() {
  const [tasks, setTasks] = useState<DailyTask[]>([])
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())
  const [categories, setCategories] = useState<Category[]>([])
  const [weekGoals, setWeekGoals] = useState<Goal[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [editingTask, setEditingTask] = useState<DailyTask | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newCategoryId, setNewCategoryId] = useState('')
  const [newGoalSeriesId, setNewGoalSeriesId] = useState('')
  const [newAutoMetric, setNewAutoMetric] = useState('')
  const [newAutoMetricTarget, setNewAutoMetricTarget] = useState('')
  const [newRecurring, setNewRecurring] = useState(true)
  const [newScheduledDate, setNewScheduledDate] = useState('')
  const [reminderId, setReminderId] = useState<string | null>(null)
  const [reminderTime, setReminderTime] = useState('')
  const [reminderEnabled, setReminderEnabled] = useState(true)
  // Empty means "not customized yet" — falls back to defaultReminderDays below.
  const [reminderDays, setReminderDays] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [metricValues, setMetricValues] = useState<Map<AutoMetric, number>>(new Map())
  const [stepGoal, setStepGoal] = useState<number | null>(null)
  const [weightToday, setWeightToday] = useState<number | null>(null)
  const [goalWeight, setGoalWeight] = useState<number | null>(null)
  const [weightInput, setWeightInput] = useState('')
  const [todayCalories, setTodayCalories] = useState<number | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [addFormOpen, setAddFormOpen] = useState(false)
  const [confirmTask, setConfirmTask] = useState<DailyTask | null>(null)
  const [metricEntryTask, setMetricEntryTask] = useState<DailyTask | null>(null)
  const [metricEntryValue, setMetricEntryValue] = useState('')
  const [viewDate, setViewDate] = useState(todayISO())
  const date = viewDate
  const weekStart = weekStartISO(new Date(viewDate + 'T00:00:00'))
  const steps = metricValues.get('steps') ?? null
  const isToday = viewDate === todayISO()

  async function load() {
    setLoading(true)
    await ensureDefaultCategories()
    await rolloverRecurringGoals()
    const [
      { data: taskRows },
      { data: completionRows },
      { data: categoryRows },
      { data: goalRows },
      { data: metricRows },
      { data: settingsRow },
      { data: reminderRows },
      { data: weightRow },
      { data: foodEntryRows },
      { data: recipeRows },
      { data: recipeIngredientRows },
      { data: ingredientRows },
    ] = await Promise.all([
      supabase
        .from('daily_tasks')
        .select('*')
        .eq('active', true)
        .or(`scheduled_date.is.null,scheduled_date.lte.${date}`)
        .order('created_at'),
      supabase.from('task_completions').select('task_id').eq('date', date),
      supabase.from('categories').select('*').order('name'),
      supabase
        .from('goals')
        .select('*')
        .eq('period_type', 'week')
        .eq('period_start', weekStart)
        .not('target_value', 'is', null),
      supabase
        .from('journal_entries')
        .select('type, value_numeric')
        .in(
          'type',
          AUTO_METRICS.map((m) => METRIC_INFO[m].journalType),
        )
        .eq('date', date),
      supabase.from('user_settings').select('*').maybeSingle(),
      supabase.from('reminders').select('*'),
      supabase
        .from('journal_entries')
        .select('value_numeric')
        .eq('type', 'weight')
        .eq('date', date)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('food_log_entries').select('*').eq('date', date),
      supabase.from('recipes').select('*'),
      supabase.from('recipe_ingredients').select('*'),
      supabase.from('ingredients').select('*'),
    ])
    const allTasks = taskRows ?? []
    const completed = new Set((completionRows ?? []).map((r) => r.task_id))
    const todaysMetrics = new Map<AutoMetric, number>()
    for (const m of AUTO_METRICS) {
      const row = (metricRows ?? []).find((r) => r.type === METRIC_INFO[m].journalType)
      if (row?.value_numeric != null) todaysMetrics.set(m, row.value_numeric)
    }

    // Auto-complete any task whose linked metric has reached its target today.
    // No target means done/not-done — any nonzero synced value counts as complete.
    const toAutoComplete = allTasks.filter((t) => {
      if (!isAutoMetric(t.auto_metric) || completed.has(t.id)) return false
      const value = todaysMetrics.get(t.auto_metric)
      if (value == null) return false
      return t.auto_metric_target != null ? value >= t.auto_metric_target : value > 0
    })
    if (toAutoComplete.length > 0) {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        await supabase
          .from('task_completions')
          .insert(toAutoComplete.map((t) => ({ task_id: t.id, date, user_id: user.id })))
        for (const t of toAutoComplete) completed.add(t.id)
        const oneTimeIds = toAutoComplete.filter((t) => !t.recurring).map((t) => t.id)
        if (oneTimeIds.length > 0) {
          await supabase.from('daily_tasks').update({ active: false }).in('id', oneTimeIds)
          // A one-time task won't recur, so its reminder shouldn't keep firing on this weekday next week.
          await supabase.from('reminders').update({ enabled: false }).in('task_id', oneTimeIds)
        }
      }
    }

    setTasks(allTasks)
    setCompletedIds(completed)
    setCategories(categoryRows ?? [])
    setWeekGoals(goalRows ?? [])
    setReminders(reminderRows ?? [])
    setMetricValues(todaysMetrics)
    setStepGoal(settingsRow?.step_goal ?? null)
    setGoalWeight(settingsRow?.goal_weight != null ? Number(settingsRow.goal_weight) : null)
    setWeightToday(weightRow?.value_numeric != null ? Number(weightRow.value_numeric) : null)
    setWeightInput(weightRow?.value_numeric != null ? String(weightRow.value_numeric) : '')

    const recipesById = new Map((recipeRows ?? []).map((r) => [r.id, r]))
    const recipeLinesByRecipe = new Map<string, RecipeIngredient[]>()
    for (const line of recipeIngredientRows ?? []) {
      const arr = recipeLinesByRecipe.get(line.recipe_id) ?? []
      arr.push(line)
      recipeLinesByRecipe.set(line.recipe_id, arr)
    }
    const ingredientsById = new Map((ingredientRows ?? []).map((i) => [i.id, i]))
    const dayTotal = (foodEntryRows ?? []).reduce(
      (sum, entry) => addMacros(sum, logEntryMacros(entry, recipesById, recipeLinesByRecipe, ingredientsById)),
      ZERO_MACROS,
    )
    setTodayCalories((foodEntryRows ?? []).length > 0 ? Math.round(dayTotal.kcal) : null)

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewDate])

  function resetForm() {
    setEditingTask(null)
    setNewTitle('')
    setNewCategoryId('')
    setNewGoalSeriesId('')
    setNewAutoMetric('')
    setNewAutoMetricTarget('')
    setNewRecurring(true)
    setNewScheduledDate(viewDate)
    setReminderId(null)
    setReminderTime('')
    setReminderEnabled(true)
    setReminderDays([])
  }

  function openAddForm() {
    resetForm()
    setAddFormOpen(true)
  }

  function openEditForm(task: DailyTask) {
    setEditingTask(task)
    setNewTitle(task.title)
    setNewCategoryId(task.category_id ?? '')
    setNewGoalSeriesId(task.goal_series_id ?? '')
    setNewAutoMetric(task.auto_metric ?? '')
    setNewAutoMetricTarget(task.auto_metric_target != null ? String(task.auto_metric_target) : '')
    setNewRecurring(task.recurring)
    setNewScheduledDate(task.scheduled_date ?? '')
    const reminder = reminders.find((r) => r.task_id === task.id)
    setReminderId(reminder?.id ?? null)
    setReminderTime(reminder ? utcTimeToLocal(reminder.time_of_day) : '')
    setReminderEnabled(reminder?.enabled ?? true)
    setReminderDays(reminder?.days_of_week ?? [])
    setAddFormOpen(true)
  }

  function closeForm() {
    setAddFormOpen(false)
    resetForm()
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim()) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const payload = {
      title: newTitle.trim(),
      category_id: newCategoryId || null,
      goal_series_id: newGoalSeriesId || null,
      auto_metric: newAutoMetric || null,
      auto_metric_target: newAutoMetric && newAutoMetricTarget ? Number(newAutoMetricTarget) : null,
      recurring: newRecurring,
      scheduled_date: newScheduledDate || null,
    }
    const finalReminderDays = reminderDays.length ? reminderDays : defaultReminderDays

    let taskId: string
    if (editingTask) {
      await supabase.from('daily_tasks').update(payload).eq('id', editingTask.id)
      taskId = editingTask.id
    } else {
      const { data: newTask } = await supabase
        .from('daily_tasks')
        .insert({ ...payload, user_id: user.id })
        .select()
        .single()
      if (!newTask) return
      taskId = newTask.id
    }

    if (reminderId) {
      if (!reminderTime) {
        await supabase.from('reminders').delete().eq('id', reminderId)
      } else {
        await supabase
          .from('reminders')
          .update({
            label: newTitle.trim(),
            time_of_day: localTimeToUTC(reminderTime),
            enabled: reminderEnabled,
            days_of_week: finalReminderDays,
          })
          .eq('id', reminderId)
      }
    } else if (reminderTime) {
      await supabase.from('reminders').insert({
        label: newTitle.trim(),
        time_of_day: localTimeToUTC(reminderTime),
        days_of_week: finalReminderDays,
        user_id: user.id,
        task_id: taskId,
      })
    }

    closeForm()
    load()
  }

  async function bumpLinkedGoal(task: DailyTask, delta: number) {
    if (!task.goal_series_id) return
    const goal = weekGoals.find((g) => g.series_id === task.goal_series_id)
    if (!goal) return
    const progress = Math.max(0, goal.progress + delta)
    const status = goal.target_value && progress >= goal.target_value ? 'done' : 'active'
    setWeekGoals((gs) => gs.map((g) => (g.id === goal.id ? { ...g, progress, status } : g)))
    await supabase.from('goals').update({ progress, status }).eq('id', goal.id)
  }

  async function toggle(task: DailyTask) {
    const isDone = completedIds.has(task.id)
    const next = new Set(completedIds)
    if (isDone) {
      next.delete(task.id)
      setCompletedIds(next)
      await supabase.from('task_completions').delete().eq('task_id', task.id).eq('date', date)
      await bumpLinkedGoal(task, -1)
      if (!task.recurring) {
        await supabase.from('daily_tasks').update({ active: true }).eq('id', task.id)
        await supabase.from('reminders').update({ enabled: true }).eq('task_id', task.id)
      }
    } else {
      next.add(task.id)
      setCompletedIds(next)
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('task_completions').insert({ task_id: task.id, date, user_id: user.id })
      await bumpLinkedGoal(task, 1)
      // One-time tasks shouldn't reappear tomorrow — archive it now; it stays visible
      // (checked, struck through) for the rest of today since local state is untouched.
      if (!task.recurring) {
        await supabase.from('daily_tasks').update({ active: false }).eq('id', task.id)
        // Won't recur, so its reminder shouldn't keep firing on this weekday next week.
        await supabase.from('reminders').update({ enabled: false }).eq('task_id', task.id)
      }
    }
  }

  function openMetricEntry(task: DailyTask) {
    if (!isAutoMetric(task.auto_metric)) return
    setMetricEntryTask(task)
    setMetricEntryValue(String(metricValues.get(task.auto_metric) ?? ''))
  }

  async function saveMetricEntry() {
    if (!metricEntryTask || !isAutoMetric(metricEntryTask.auto_metric)) return
    const value = Number(metricEntryValue)
    if (!metricEntryValue || Number.isNaN(value)) return
    await upsertMetricValue(metricEntryTask.auto_metric, date, value)
    setMetricEntryTask(null)
    load()
  }

  async function logWeight() {
    const value = Number(weightInput)
    if (!weightInput || Number.isNaN(value)) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('journal_entries').insert({ type: 'weight', value_numeric: value, date, user_id: user.id })
    load()
  }

  async function removeTask(task: DailyTask) {
    await supabase.from('daily_tasks').update({ active: false }).eq('id', task.id)
    load()
  }

  // Calorie-budget tasks aren't in completedIds (see CALORIE_BUDGET_METRIC) — their done
  // state is derived live from today's Food-log total instead of a stored completion row.
  function isTaskDone(task: DailyTask): boolean {
    if (task.auto_metric === CALORIE_BUDGET_METRIC) {
      return task.auto_metric_target != null && (todayCalories ?? 0) <= task.auto_metric_target
    }
    return completedIds.has(task.id)
  }

  const doneCount = tasks.filter(isTaskDone).length
  const pct = tasks.length ? (doneCount / tasks.length) * 100 : 0
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const metricEntryInfo = metricEntryTask && isAutoMetric(metricEntryTask.auto_metric) ? METRIC_INFO[metricEntryTask.auto_metric] : null
  // Recurring tasks default to reminding every day; a one-time task only has one
  // relevant day, so default to the weekday it's actually scheduled for.
  const defaultReminderDays = newRecurring
    ? [0, 1, 2, 3, 4, 5, 6]
    : [getDay(new Date((newScheduledDate || viewDate) + 'T00:00:00'))]
  const activeReminderDays = reminderDays.length ? reminderDays : defaultReminderDays

  const hero = (
    <>
      {(tasks.length > 0 || steps != null || weightToday != null || todayCalories != null) && (
        <button onClick={() => setSummaryOpen((o) => !o)} className="mt-5 flex w-full items-center gap-4 text-left">
          {tasks.length > 0 && (
            <ProgressRing
              percent={pct}
              size={66}
              strokeWidth={6}
              color={THEME.pineArc}
              trackColor={THEME.heroRingTrack}
              disc={THEME.pineDisc}
            >
              <span className="text-base font-semibold text-white">
                {doneCount}/{tasks.length}
              </span>
            </ProgressRing>
          )}
          <span className="flex flex-wrap gap-1.5">
            {steps != null && <HeroChip>🚶 {steps.toLocaleString()}</HeroChip>}
            {weightToday != null && <HeroChip>⚖️ {weightToday} kg</HeroChip>}
            {todayCalories != null && <HeroChip>🔥 {todayCalories.toLocaleString()} kcal</HeroChip>}
          </span>
        </button>
      )}

      <div className="mt-4 flex items-center justify-between gap-2 rounded-[18px] bg-white/14 px-2.5 py-[7px]">
        <button
          onClick={() => setViewDate((d) => format(subDays(new Date(d + 'T00:00:00'), 1), 'yyyy-MM-dd'))}
          aria-label="Previous day"
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-white/18 text-white"
        >
          ‹
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-white">
            {isToday ? 'Today' : format(new Date(viewDate + 'T00:00:00'), 'EEEE, MMM d')}
          </span>
          {!isToday && (
            <button
              onClick={() => setViewDate(todayISO())}
              className="shrink-0 rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-pine"
            >
              Jump to today
            </button>
          )}
        </div>
        <button
          onClick={() => setViewDate((d) => format(addDays(new Date(d + 'T00:00:00'), 1), 'yyyy-MM-dd'))}
          aria-label="Next day"
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-white/18 text-white"
        >
          ›
        </button>
      </div>
    </>
  )

  return (
    <Screen title="Today" onRefresh={load} hero={hero}>
      <MorningCheckIn onSaved={load} />

      {summaryOpen && (
        <div className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-4 shadow-card">
          {steps != null && (
            <div className="flex items-center gap-4">
              <ProgressRing percent={stepGoal ? (steps / stepGoal) * 100 : 0} size={48} strokeWidth={5}>
                <span className="text-xs">🚶</span>
              </ProgressRing>
              <div>
                <p className="font-semibold text-ink">
                  {steps.toLocaleString()} {stepGoal ? `/ ${stepGoal.toLocaleString()}` : ''} steps
                </p>
                <p className="text-xs font-medium text-ink-muted">Synced from Garmin</p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-cat-violet-tint text-lg">⚖️</span>
            <div className="flex-1">
              {weightToday != null ? (
                <>
                  <p className="font-semibold text-ink">{weightToday} kg</p>
                  <p className="text-xs font-medium text-ink-muted">
                    {goalWeight != null ? `Goal ${goalWeight} kg` : `Logged ${isToday ? 'today' : 'that day'}`}
                  </p>
                </>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={weightInput}
                    onChange={(e) => setWeightInput(e.target.value)}
                    type="number"
                    step="0.1"
                    placeholder="Log weight (kg)"
                    className="min-w-0 flex-1 rounded-[20px] border border-line bg-surface px-3 py-2 text-sm text-ink placeholder-ink-disabled outline-none focus:border-pine"
                  />
                  <button onClick={logWeight} className="shrink-0 rounded-[20px] bg-pine px-4 py-2 text-sm font-semibold text-white">
                    Log
                  </button>
                </div>
              )}
            </div>
          </div>
          {todayCalories != null && (
            <div className="flex items-center gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-cat-amber-tint text-lg">🔥</span>
              <div>
                <p className="font-semibold text-ink">{todayCalories.toLocaleString()} kcal</p>
                <p className="text-xs font-medium text-ink-muted">See Journal for a breakdown</p>
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-disabled">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-ink-disabled">No daily tasks yet. Add one below.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {tasks.map((task) => {
            const isBudget = task.auto_metric === CALORIE_BUDGET_METRIC
            const done = isTaskDone(task)
            const category = task.category_id ? categoryById.get(task.category_id) : undefined
            const style = category ? CATEGORY_STYLES[category.color] : CATEGORY_STYLES.violet
            const goal = task.goal_series_id ? weekGoals.find((g) => g.series_id === task.goal_series_id) : undefined
            const metric = isAutoMetric(task.auto_metric) ? task.auto_metric : null
            const metricInfo = metric ? METRIC_INFO[metric] : null
            const effectiveStartDate = task.scheduled_date ?? task.created_at.slice(0, 10)
            const isLate = !task.recurring && !done && effectiveStartDate < viewDate
            const metricValue = metric ? metricValues.get(metric) ?? 0 : null
            // A metric with a target trades the long caption for a bar and what's left to
            // do; without one there's nothing to fill, so it keeps a plain value readout.
            const metricPct =
              metric && metricValue != null && task.auto_metric_target
                ? Math.min(100, (metricValue / task.auto_metric_target) * 100)
                : null
            const metricRemaining =
              metric && metricValue != null && task.auto_metric_target ? task.auto_metric_target - metricValue : null
            // One metadata line, in category ink — category, linked goal, and the one-time
            // or late state, rather than a row of separate badges.
            const metaParts: React.ReactNode[] = []
            if (category) metaParts.push(category.name)
            if (goal) metaParts.push(`→ ${goal.title} ${goal.progress}/${goal.target_value}`)
            if (!task.recurring) {
              metaParts.push(isLate ? <span className="text-cat-rose-ink">late</span> : 'one-time')
            }
            return (
              <li
                key={task.id}
                className="flex items-center gap-3 overflow-hidden rounded-[22px] border border-line bg-surface shadow-card"
              >
                <span className="w-[5px] self-stretch" style={{ background: style.accent }} />
                <button
                  onClick={() => (metric ? openMetricEntry(task) : isBudget ? undefined : toggle(task))}
                  className="flex min-w-0 flex-1 items-center gap-3 py-3.5 text-left"
                >
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] text-lg font-semibold"
                    style={{ background: style.tint, color: style.ink }}
                  >
                    {isBudget ? '🔥' : metricInfo ? metricInfo.icon : category ? category.name.charAt(0).toUpperCase() : '•'}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    {/* Two lines at most — the design draws one, but a real title like
                        "Stay under calorie budget" doesn't fit beside the row controls. */}
                    <span
                      className={`line-clamp-2 text-[15px] leading-snug ${done ? 'text-ink-disabled line-through' : 'font-medium text-ink'}`}
                    >
                      {task.title}
                    </span>
                    {metricPct != null ? (
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                          <span
                            className="block h-full rounded-full"
                            style={{ width: `${metricPct}%`, background: style.accent }}
                          />
                        </span>
                        <span className="shrink-0 text-[11px] font-semibold" style={{ color: style.ink }}>
                          {metricRemaining! > 0 ? `${metricRemaining!.toLocaleString()} to go` : 'goal met'}
                        </span>
                      </span>
                    ) : (
                      <span className="truncate text-[11px] font-semibold" style={{ color: style.ink }}>
                        {isBudget ? (
                          <>
                            {(todayCalories ?? 0).toLocaleString()}
                            {task.auto_metric_target != null && ` / ${task.auto_metric_target.toLocaleString()}`} kcal
                          </>
                        ) : metricInfo ? (
                          `${metricValue?.toLocaleString()} ${metricInfo.unit}`
                        ) : (
                          metaParts.map((part, i) => (
                            <span key={i}>
                              {i > 0 && ' · '}
                              {part}
                            </span>
                          ))
                        )}
                      </span>
                    )}
                  </span>
                </button>
                <button onClick={() => openEditForm(task)} className="shrink-0 px-0.5 text-sm text-ink-faint" aria-label="Edit task">
                  ✎
                </button>
                <button onClick={() => setConfirmTask(task)} className="shrink-0 px-0.5 text-sm text-ink-faint" aria-label="Remove task">
                  ✕
                </button>
                <button
                  onClick={() => (metric ? openMetricEntry(task) : isBudget ? undefined : toggle(task))}
                  aria-label={done ? 'Mark not done' : 'Mark done'}
                  className="mx-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                  style={done ? { background: style.check } : { border: `2px solid ${THEME.lineStrong}` }}
                >
                  {done && (
                    <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="none">
                      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <button
        onClick={openAddForm}
        className="rounded-[20px] border border-line-strong bg-surface p-3.5 text-[15px] font-semibold text-pine"
      >
        + Add task
      </button>

      {addFormOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-page safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-ink">{editingTask ? 'Edit task' : 'New task'}</h2>
            <button onClick={closeForm} className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2">
              Close ✕
            </button>
          </div>
          <form onSubmit={submitForm} className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="New daily task"
              className="rounded-[20px] border border-line bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
            />
            <div className="flex gap-2">
              <select
                value={newCategoryId}
                onChange={(e) => setNewCategoryId(e.target.value)}
                className="min-w-0 flex-1 rounded-[20px] border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-pine"
              >
                <option value="">No label</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={newGoalSeriesId}
                onChange={(e) => setNewGoalSeriesId(e.target.value)}
                className="min-w-0 flex-1 rounded-[20px] border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-pine"
              >
                <option value="">No linked goal</option>
                {weekGoals.map((g) => (
                  <option key={g.series_id} value={g.series_id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <select
                value={newAutoMetric}
                onChange={(e) => setNewAutoMetric(e.target.value)}
                className="min-w-0 flex-1 rounded-[20px] border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-pine"
              >
                <option value="">Manual check-off</option>
                {AUTO_METRICS.map((m) => (
                  <option key={m} value={m}>
                    Auto from {METRIC_INFO[m].label}
                  </option>
                ))}
                <option value={CALORIE_BUDGET_METRIC}>Stay under budget: Calories (Food log)</option>
              </select>
              {newAutoMetric && (
                <input
                  value={newAutoMetricTarget}
                  onChange={(e) => setNewAutoMetricTarget(e.target.value)}
                  type="number"
                  placeholder={
                    newAutoMetric === CALORIE_BUDGET_METRIC
                      ? 'Target, e.g. 2400 kcal'
                      : `Target (optional), e.g. 10000 ${METRIC_INFO[newAutoMetric as AutoMetric]?.unit ?? ''}`
                  }
                  className="min-w-0 flex-1 rounded-[20px] border border-line bg-surface px-4 py-2.5 text-sm text-ink placeholder-ink-disabled outline-none focus:border-pine"
                />
              )}
            </div>
            {newAutoMetric === CALORIE_BUDGET_METRIC ? (
              <p className="text-xs text-ink-disabled">
                Checked off while today's logged Food total stays at or under the target — unchecks itself if you go over.
              </p>
            ) : (
              newAutoMetric &&
              !newAutoMetricTarget && (
                <p className="text-xs text-ink-disabled">
                  No target set — this task auto-completes as soon as any {METRIC_INFO[newAutoMetric as AutoMetric].label.toLowerCase()}{' '}
                  is logged today.
                </p>
              )
            )}
            <div className="flex gap-2 rounded-[20px] bg-track p-1">
              <button
                type="button"
                onClick={() => setNewRecurring(true)}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  newRecurring ? 'bg-surface text-pine shadow-card' : 'text-ink-3'
                }`}
              >
                Recurring daily
              </button>
              <button
                type="button"
                onClick={() => setNewRecurring(false)}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  !newRecurring ? 'bg-surface text-pine shadow-card' : 'text-ink-3'
                }`}
              >
                One-time
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-sm text-ink-3">Starts on</span>
              <input
                value={newScheduledDate}
                onChange={(e) => setNewScheduledDate(e.target.value)}
                type="date"
                className="min-w-0 flex-1 rounded-[20px] border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:border-pine"
              />
            </div>
            <div className="flex flex-col gap-2 rounded-[20px] border border-line-strong p-3">
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-sm text-ink-3">Remind me at</span>
                <input
                  value={reminderTime}
                  onChange={(e) => setReminderTime(e.target.value)}
                  type="time"
                  className="min-w-0 flex-1 rounded-[20px] border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:border-pine"
                />
                <span className="shrink-0 text-sm text-ink-3">if not done</span>
              </div>
              {reminderTime && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ink-3">Reminder enabled</span>
                    <button
                      type="button"
                      onClick={() => setReminderEnabled((v) => !v)}
                      className={`h-6 w-11 rounded-full transition ${reminderEnabled ? 'bg-pine' : 'bg-line'}`}
                    >
                      <span
                        className={`block h-5 w-5 translate-y-0.5 rounded-full bg-surface transition ${
                          reminderEnabled ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                  <div className="flex gap-1">
                    {DAY_LABELS.map((d, i) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() =>
                          setReminderDays((days) => {
                            const base = days.length ? days : defaultReminderDays
                            return base.includes(i) ? base.filter((x) => x !== i) : [...base, i].sort()
                          })
                        }
                        className={`flex-1 rounded-xl py-1 text-xs font-medium ${
                          activeReminderDays.includes(i) ? 'bg-cat-emerald-tint text-pine' : 'bg-track text-ink-disabled'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  {reminderId && (
                    <button type="button" onClick={() => setReminderTime('')} className="text-left text-sm font-medium text-cat-rose-ink">
                      Delete reminder
                    </button>
                  )}
                </>
              )}
            </div>
            <button type="submit" className="rounded-[20px] bg-pine px-4 py-2.5 font-semibold text-white">
              {editingTask ? 'Save changes' : 'Add task'}
            </button>
          </form>
        </div>
      )}

      {metricEntryTask && metricEntryInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={() => setMetricEntryTask(null)}>
          <div className="w-full max-w-xs rounded-3xl border border-line bg-surface p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold text-ink">{metricEntryTask.title}</p>
            <p className="mt-1 text-sm text-ink-3">
              Enter {isToday ? "today's" : "that day's"} {metricEntryInfo.label.toLowerCase()} if it didn't sync automatically.
            </p>
            <input
              autoFocus
              value={metricEntryValue}
              onChange={(e) => setMetricEntryValue(e.target.value)}
              type="number"
              placeholder={`e.g. ${metricEntryTask.auto_metric_target ?? ''} ${metricEntryInfo.unit}`}
              className="mt-3 w-full rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setMetricEntryTask(null)}
                className="flex-1 rounded-[20px] bg-track px-4 py-2.5 font-medium text-ink-2"
              >
                Cancel
              </button>
              <button onClick={saveMetricEntry} className="flex-1 rounded-[20px] bg-pine px-4 py-2.5 font-semibold text-white">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmTask !== null}
        title={`Remove "${confirmTask?.title ?? ''}"?`}
        message="This archives the task — it'll no longer show up in your daily list."
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirmTask) removeTask(confirmTask)
          setConfirmTask(null)
        }}
        onCancel={() => setConfirmTask(null)}
      />
    </Screen>
  )
}
