import { useEffect, useState } from 'react'
import { format, addDays, subDays } from 'date-fns'
import { supabase } from '../lib/supabase'
import { todayISO, weekStartISO, localTimeToUTC, utcTimeToLocal, DAY_LABELS } from '../lib/dates'
import { rolloverRecurringGoals } from '../lib/goals'
import { ensureDefaultCategories, CATEGORY_STYLES } from '../lib/categories'
import { AUTO_METRICS, METRIC_INFO, isAutoMetric, upsertMetricValue, type AutoMetric } from '../lib/metrics'
import { ProgressRing } from '../components/ProgressRing'
import { RefreshButton } from '../components/RefreshButton'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { Category, DailyTask, Reminder, WeeklyGoal } from '../lib/types'

export function Today() {
  const [tasks, setTasks] = useState<DailyTask[]>([])
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())
  const [categories, setCategories] = useState<Category[]>([])
  const [weekGoals, setWeekGoals] = useState<WeeklyGoal[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [editingTask, setEditingTask] = useState<DailyTask | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newCategoryId, setNewCategoryId] = useState('')
  const [newGoalSeriesId, setNewGoalSeriesId] = useState('')
  const [newAutoMetric, setNewAutoMetric] = useState('')
  const [newAutoMetricTarget, setNewAutoMetricTarget] = useState('')
  const [newRecurring, setNewRecurring] = useState(true)
  const [reminderId, setReminderId] = useState<string | null>(null)
  const [reminderTime, setReminderTime] = useState('')
  const [reminderEnabled, setReminderEnabled] = useState(true)
  const [reminderDays, setReminderDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6])
  const [loading, setLoading] = useState(true)
  const [metricValues, setMetricValues] = useState<Map<AutoMetric, number>>(new Map())
  const [stepGoal, setStepGoal] = useState<number | null>(null)
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
    const [{ data: taskRows }, { data: completionRows }, { data: categoryRows }, { data: goalRows }, { data: metricRows }, { data: settingsRow }, { data: reminderRows }] =
      await Promise.all([
        supabase
          .from('daily_tasks')
          .select('*')
          .eq('active', true)
          .or(`scheduled_date.is.null,scheduled_date.lte.${date}`)
          .order('created_at'),
        supabase.from('task_completions').select('task_id').eq('date', date),
        supabase.from('categories').select('*').order('name'),
        supabase.from('weekly_goals').select('*').eq('week_start', weekStart).not('target_value', 'is', null),
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
      ])
    const allTasks = taskRows ?? []
    const completed = new Set((completionRows ?? []).map((r) => r.task_id))
    const todaysMetrics = new Map<AutoMetric, number>()
    for (const m of AUTO_METRICS) {
      const row = (metricRows ?? []).find((r) => r.type === METRIC_INFO[m].journalType)
      if (row?.value_numeric != null) todaysMetrics.set(m, row.value_numeric)
    }

    // Auto-complete any task whose linked metric has reached its target today.
    const toAutoComplete = allTasks.filter((t) => {
      if (!isAutoMetric(t.auto_metric) || t.auto_metric_target == null || completed.has(t.id)) return false
      const value = todaysMetrics.get(t.auto_metric)
      return value != null && value >= t.auto_metric_target
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
        if (oneTimeIds.length > 0) await supabase.from('daily_tasks').update({ active: false }).in('id', oneTimeIds)
      }
    }

    setTasks(allTasks)
    setCompletedIds(completed)
    setCategories(categoryRows ?? [])
    setWeekGoals(goalRows ?? [])
    setReminders(reminderRows ?? [])
    setMetricValues(todaysMetrics)
    setStepGoal(settingsRow?.step_goal ?? null)
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
    setReminderId(null)
    setReminderTime('')
    setReminderEnabled(true)
    setReminderDays([0, 1, 2, 3, 4, 5, 6])
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
    const reminder = reminders.find((r) => r.task_id === task.id)
    setReminderId(reminder?.id ?? null)
    setReminderTime(reminder ? utcTimeToLocal(reminder.time_of_day) : '')
    setReminderEnabled(reminder?.enabled ?? true)
    setReminderDays(reminder?.days_of_week ?? [0, 1, 2, 3, 4, 5, 6])
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
    }

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
            days_of_week: reminderDays,
          })
          .eq('id', reminderId)
      }
    } else if (reminderTime) {
      await supabase.from('reminders').insert({
        label: newTitle.trim(),
        time_of_day: localTimeToUTC(reminderTime),
        days_of_week: reminderDays,
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
    await supabase.from('weekly_goals').update({ progress, status }).eq('id', goal.id)
  }

  async function toggle(task: DailyTask) {
    const isDone = completedIds.has(task.id)
    const next = new Set(completedIds)
    if (isDone) {
      next.delete(task.id)
      setCompletedIds(next)
      await supabase.from('task_completions').delete().eq('task_id', task.id).eq('date', date)
      await bumpLinkedGoal(task, -1)
      if (!task.recurring) await supabase.from('daily_tasks').update({ active: true }).eq('id', task.id)
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
      if (!task.recurring) await supabase.from('daily_tasks').update({ active: false }).eq('id', task.id)
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

  async function removeTask(task: DailyTask) {
    await supabase.from('daily_tasks').update({ active: false }).eq('id', task.id)
    load()
  }

  const doneCount = tasks.filter((t) => completedIds.has(t.id)).length
  const pct = tasks.length ? (doneCount / tasks.length) * 100 : 0
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const metricEntryInfo = metricEntryTask && isAutoMetric(metricEntryTask.auto_metric) ? METRIC_INFO[metricEntryTask.auto_metric] : null

  return (
    <div className="flex flex-col gap-4 px-4 pt-6 pb-2">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Manage Your Daily Tasks</h1>
        <RefreshButton onRefresh={load} />
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white px-2 py-1.5 shadow-sm">
        <button
          onClick={() => setViewDate((d) => format(subDays(new Date(d + 'T00:00:00'), 1), 'yyyy-MM-dd'))}
          className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500"
        >
          ‹
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">
            {isToday ? 'Today' : format(new Date(viewDate + 'T00:00:00'), 'EEEE, MMM d')}
          </span>
          {!isToday && (
            <button onClick={() => setViewDate(todayISO())} className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-600">
              Jump to today
            </button>
          )}
        </div>
        <button
          onClick={() => setViewDate((d) => format(addDays(new Date(d + 'T00:00:00'), 1), 'yyyy-MM-dd'))}
          className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500"
        >
          ›
        </button>
      </div>

      {(tasks.length > 0 || steps != null) && (
        <div className="rounded-3xl border border-gray-100 bg-white shadow-sm">
          <button
            onClick={() => setSummaryOpen((o) => !o)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="flex items-center gap-3 text-sm font-medium text-gray-700">
              {tasks.length > 0 && <span>✓ {doneCount}/{tasks.length} tasks</span>}
              {steps != null && (
                <span>
                  🚶 {steps.toLocaleString()}
                  {stepGoal ? `/${stepGoal.toLocaleString()}` : ''} steps
                </span>
              )}
            </span>
            <span className={`text-gray-400 transition-transform ${summaryOpen ? 'rotate-180' : ''}`}>⌄</span>
          </button>

          {summaryOpen && (
            <div className="flex flex-col gap-3 border-t border-gray-100 p-4">
              {tasks.length > 0 && (
                <div className="flex items-center gap-4">
                  <ProgressRing percent={pct} color="#db2777" trackColor="#fce7f3">
                    <span className="text-sm font-bold text-gray-900">{Math.round(pct)}%</span>
                  </ProgressRing>
                  <div>
                    <p className="font-semibold text-gray-900">
                      {doneCount}/{tasks.length} done
                    </p>
                    <p className="text-sm text-gray-500">Keep it up today</p>
                  </div>
                </div>
              )}
              {steps != null && (
                <div className="flex items-center gap-4">
                  <ProgressRing percent={stepGoal ? (steps / stepGoal) * 100 : 0} color="#0284c7" trackColor="#e0f2fe">
                    <span className="text-xs">🚶</span>
                  </ProgressRing>
                  <div>
                    <p className="font-semibold text-gray-900">
                      {steps.toLocaleString()} {stepGoal ? `/ ${stepGoal.toLocaleString()}` : ''} steps
                    </p>
                    <p className="text-sm text-gray-500">Synced from Garmin</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-gray-400">No daily tasks yet. Add one below.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => {
            const done = completedIds.has(task.id)
            const category = task.category_id ? categoryById.get(task.category_id) : undefined
            const style = category ? CATEGORY_STYLES[category.color] : CATEGORY_STYLES.violet
            const goal = task.goal_series_id ? weekGoals.find((g) => g.series_id === task.goal_series_id) : undefined
            const metric = isAutoMetric(task.auto_metric) ? task.auto_metric : null
            const metricInfo = metric ? METRIC_INFO[metric] : null
            const effectiveStartDate = task.scheduled_date ?? task.created_at.slice(0, 10)
            const isLate = !task.recurring && !done && effectiveStartDate < viewDate
            return (
              <li
                key={task.id}
                className="flex items-center justify-between overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm"
              >
                <span className={`h-full w-1.5 self-stretch ${style.dot}`} />
                <button
                  onClick={() => (metric ? openMetricEntry(task) : toggle(task))}
                  className="flex flex-1 items-center gap-3 px-4 py-3.5 text-left"
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                      done ? `border-transparent ${style.dot}` : 'border-gray-300'
                    }`}
                  >
                    {done && (
                      <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="none">
                        <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className="flex flex-col">
                    <span className={done ? 'text-gray-400 line-through' : 'font-medium text-gray-900'}>{task.title}</span>
                    <span className="flex items-center gap-1.5">
                      {category && (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.bg} ${style.text}`}>
                          {category.name}
                        </span>
                      )}
                      {goal && (
                        <span className="text-[11px] text-gray-400">
                          → {goal.title} {goal.progress}/{goal.target_value}
                        </span>
                      )}
                      {metric && metricInfo && (
                        <span className="text-[11px] text-gray-400">
                          {metricInfo.icon} {(metricValues.get(metric) ?? 0).toLocaleString()}
                          {task.auto_metric_target != null && `/${task.auto_metric_target.toLocaleString()}`} {metricInfo.unit} — tap to
                          set manually
                        </span>
                      )}
                      {isLate ? (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-600">Late</span>
                      ) : (
                        !task.recurring && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">One-time</span>
                        )
                      )}
                    </span>
                  </span>
                </button>
                <button onClick={() => openEditForm(task)} className="px-2 text-gray-300" aria-label="Edit task">
                  ✎
                </button>
                <button onClick={() => setConfirmTask(task)} className="px-4 text-gray-300" aria-label="Remove task">
                  ✕
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <button
        onClick={openAddForm}
        className="rounded-2xl border-2 border-dashed border-gray-200 py-3 text-sm font-semibold text-violet-600"
      >
        + Add task
      </button>

      {addFormOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-gray-900">{editingTask ? 'Edit task' : 'New task'}</h2>
            <button onClick={closeForm} className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600">
              Close ✕
            </button>
          </div>
          <form onSubmit={submitForm} className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="New daily task"
              className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-violet-400"
            />
            <div className="flex gap-2">
              <select
                value={newCategoryId}
                onChange={(e) => setNewCategoryId(e.target.value)}
                className="flex-1 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-gray-900 outline-none focus:border-violet-400"
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
                className="flex-1 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-gray-900 outline-none focus:border-violet-400"
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
                className="flex-1 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-gray-900 outline-none focus:border-violet-400"
              >
                <option value="">Manual check-off</option>
                {AUTO_METRICS.map((m) => (
                  <option key={m} value={m}>
                    Auto from {METRIC_INFO[m].label}
                  </option>
                ))}
              </select>
              {newAutoMetric && (
                <input
                  value={newAutoMetricTarget}
                  onChange={(e) => setNewAutoMetricTarget(e.target.value)}
                  type="number"
                  placeholder={`Target, e.g. 10000 ${METRIC_INFO[newAutoMetric as AutoMetric]?.unit ?? ''}`}
                  className="flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-violet-400"
                />
              )}
            </div>
            <div className="flex gap-2 rounded-2xl bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setNewRecurring(true)}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  newRecurring ? 'bg-white text-violet-600 shadow-sm' : 'text-gray-500'
                }`}
              >
                Recurring daily
              </button>
              <button
                type="button"
                onClick={() => setNewRecurring(false)}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  !newRecurring ? 'bg-white text-violet-600 shadow-sm' : 'text-gray-500'
                }`}
              >
                One-time
              </button>
            </div>
            <div className="flex flex-col gap-2 rounded-2xl border border-gray-200 p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">Remind me at</span>
                <input
                  value={reminderTime}
                  onChange={(e) => setReminderTime(e.target.value)}
                  type="time"
                  className="flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 outline-none focus:border-violet-400"
                />
                <span className="text-sm text-gray-500">if not done</span>
              </div>
              {reminderTime && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Reminder enabled</span>
                    <button
                      type="button"
                      onClick={() => setReminderEnabled((v) => !v)}
                      className={`h-6 w-11 rounded-full transition ${reminderEnabled ? 'bg-violet-600' : 'bg-gray-200'}`}
                    >
                      <span
                        className={`block h-5 w-5 translate-y-0.5 rounded-full bg-white transition ${
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
                        onClick={() => setReminderDays((days) => (days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort()))}
                        className={`flex-1 rounded-xl py-1 text-xs font-medium ${
                          reminderDays.includes(i) ? 'bg-violet-100 text-violet-600' : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  {reminderId && (
                    <button type="button" onClick={() => setReminderTime('')} className="text-left text-sm font-medium text-rose-600">
                      Delete reminder
                    </button>
                  )}
                </>
              )}
            </div>
            <button type="submit" className="rounded-2xl bg-violet-600 px-4 py-2.5 font-semibold text-white">
              {editingTask ? 'Save changes' : 'Add task'}
            </button>
          </form>
        </div>
      )}

      {metricEntryTask && metricEntryInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={() => setMetricEntryTask(null)}>
          <div className="w-full max-w-xs rounded-3xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold text-gray-900">{metricEntryTask.title}</p>
            <p className="mt-1 text-sm text-gray-500">
              Enter {isToday ? "today's" : "that day's"} {metricEntryInfo.label.toLowerCase()} if it didn't sync automatically.
            </p>
            <input
              autoFocus
              value={metricEntryValue}
              onChange={(e) => setMetricEntryValue(e.target.value)}
              type="number"
              placeholder={`e.g. ${metricEntryTask.auto_metric_target ?? ''} ${metricEntryInfo.unit}`}
              className="mt-3 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-violet-400"
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setMetricEntryTask(null)}
                className="flex-1 rounded-2xl bg-gray-100 px-4 py-2.5 font-medium text-gray-600"
              >
                Cancel
              </button>
              <button onClick={saveMetricEntry} className="flex-1 rounded-2xl bg-violet-600 px-4 py-2.5 font-semibold text-white">
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
    </div>
  )
}
