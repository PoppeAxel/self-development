import { useEffect, useState } from 'react'
import { format, addDays, getDay } from 'date-fns'
import { supabase } from '../lib/supabase'
import {
  todayISO,
  weekStartISO,
  periodEndISO,
  PERIOD_TYPES,
  DAY_LABELS,
} from '../lib/dates'
import {
  rolloverRecurringGoals,
  goalPace,
  isGoalDone,
  paceVerdict,
  resolveGoalProgress,
  type GoalPace,
} from '../lib/goals'
import { CATEGORY_STYLES } from '../lib/categories'
import { LabelPicker } from '../components/LabelPicker'
import { AUTO_METRICS, METRIC_INFO, isAutoMetric, upsertMetricValue, type AutoMetric } from '../lib/metrics'
import { addMacros, logEntryMacros, ZERO_MACROS } from '../lib/food'
import { THEME } from '../lib/theme'
import { ProgressRing } from '../components/ProgressRing'
import { useNav } from '../contexts/NavContext'
import { Screen, HeroChip } from '../components/Screen'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { MorningCheckIn } from '../components/MorningCheckIn'
import { DailyCheckin } from '../components/DailyCheckin'
import { checkinDateISO } from '../lib/dailyCheckin'
import { WEEK_ORDER, habitHistory, isScheduledOn, repeatLabel } from '../lib/planner'
import { findOption, live } from '../lib/optionStore'
import type { OptionRow } from '../lib/editable'
import { useEdit } from '../contexts/EditContext'
import { EditDots, Pressable } from '../components/ItemMenu'
import { OptionSheet } from '../components/OptionSheet'
import { Reminders } from '../components/Reminders'
import type { Category, DailyTask, Goal, Reminder, RecipeIngredient } from '../lib/types'

// A task whose auto_metric is this sentinel auto-completes off today's Food-log total
// instead of a synced journal metric — and unlike every other auto_metric (which only
// grows toward a floor), it's a ceiling: done means "at or under budget," so it can
// un-complete itself later in the day if more food gets logged and the total goes over.
const CALORIE_BUDGET_METRIC = 'calorie_budget'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const shiftISO = (date: string, days: number) => iso(addDays(new Date(date + 'T00:00:00'), days))
const WEEKDAYS = [1, 2, 3, 4, 5]
// The quick-add bar's "when" chips: `options` rows (kind 'quick_when', migration 0051), edited in
// place on the chips. Each is a one-time to-do `offset` days after the day shown, or a habit
// repeating on `days` (0 = Sunday; null = every day).
interface QuickWhen {
  key: string
  label: string
  repeat: boolean
  offset: number
  days: number[] | null
}
const quickWhens = (): QuickWhen[] =>
  live('quick_when').map((r) => ({
    key: r.key,
    label: r.label,
    repeat: r.meta.repeat === true,
    offset: Number(r.meta.offset ?? 0),
    days: Array.isArray(r.meta.days) ? (r.meta.days as number[]) : null,
  }))

export function Today() {
  // Daily check-in: red until tonight's row exists, green after. The 22:00 push opens
  // /?checkin=1, which lands straight in the check-in.
  const checkinDate = checkinDateISO()
  const [checkinDone, setCheckinDone] = useState<boolean | null>(null)
  const [checkinOpen, setCheckinOpen] = useState(() => new URLSearchParams(window.location.search).has('checkin'))
  async function loadCheckin() {
    const { data } = await supabase.from('daily_checkins').select('id').eq('date', checkinDate).maybeSingle()
    setCheckinDone(!!data)
  }
  useEffect(() => {
    loadCheckin()
    if (checkinOpen) window.history.replaceState(null, '', window.location.pathname)
  }, [])
  // `tasks` is what's on the viewed day; `allTasks` every active one (the week strip needs
  // to know what each other day had planned).
  const [tasks, setTasks] = useState<DailyTask[]>([])
  const [allTasks, setAllTasks] = useState<DailyTask[]>([])
  const [upcoming, setUpcoming] = useState<DailyTask[]>([])
  // Completion dates per task over the last nine weeks — habit dots and the week strip.
  const [history, setHistory] = useState<Map<string, Set<string>>>(new Map())
  const [quickTitle, setQuickTitle] = useState('')
  const [quickWhen, setQuickWhen] = useState<string>(() => quickWhens()[0]?.key ?? '')
  // The chip picked, or the first one if it was deleted meanwhile.
  const when: QuickWhen = quickWhens().find((w) => w.key === quickWhen) ?? quickWhens()[0] ?? { key: '', label: '', repeat: false, offset: 0, days: null }
  const { editing } = useEdit()
  const [whenSheet, setWhenSheet] = useState<OptionRow | 'new' | null>(null)
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())
  const [categories, setCategories] = useState<Category[]>([])
  const { openGoalDetail } = useNav()
  const [weekGoals, setWeekGoals] = useState<Goal[]>([])
  // Every goal a task on this day points at — any horizon, not just this week's — with its
  // progress and pace resolved, so a task row can say which goal it moves and how that goal
  // is doing. Keyed by series_id, which is what daily_tasks.goal_series_id holds.
  const [taskGoals, setTaskGoals] = useState<Map<string, { goal: Goal; progress: number; pace: GoalPace; done: boolean }>>(
    new Map(),
  )
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [editingTask, setEditingTask] = useState<DailyTask | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newCategoryId, setNewCategoryId] = useState('')
  const [newGoalSeriesId, setNewGoalSeriesId] = useState('')
  const [newAutoMetric, setNewAutoMetric] = useState('')
  const [newAutoMetricTarget, setNewAutoMetricTarget] = useState('')
  const [newRecurring, setNewRecurring] = useState(true)
  const [newRepeatDays, setNewRepeatDays] = useState<number[] | null>(null)
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
  const historyFrom = shiftISO(date, -62)
  const steps = metricValues.get('steps') ?? null
  const isToday = viewDate === todayISO()

  async function load() {
    setLoading(true)
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
      { data: historyRows },
      { data: upcomingRows },
    ] = await Promise.all([
      supabase
        .from('daily_tasks')
        .select('*')
        .eq('active', true)
        .or(`scheduled_date.is.null,scheduled_date.lte.${date}`)
        .order('created_at'),
      supabase.from('task_completions').select('task_id').eq('date', date),
      supabase.from('categories').select('*').order('position').order('name'),
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
      supabase.from('task_completions').select('task_id, date').gte('date', historyFrom).lte('date', shiftISO(weekStart, 6)),
      supabase
        .from('daily_tasks')
        .select('*')
        .eq('active', true)
        .eq('recurring', false)
        .gt('scheduled_date', date)
        .lte('scheduled_date', shiftISO(date, 14))
        .order('scheduled_date'),
    ])
    const activeTasks = (taskRows ?? []) as DailyTask[]
    // A finished one-time task is archived (active = false) the moment it's ticked, so on a
    // reload it would vanish from the day it was done — fetch those back so the day keeps
    // its record on screen.
    const doneIds = (completionRows ?? []).map((r) => r.task_id as string)
    const missing = doneIds.filter((id) => !activeTasks.some((t) => t.id === id))
    const archivedDone = missing.length
      ? (((await supabase.from('daily_tasks').select('*').in('id', missing)).data ?? []) as DailyTask[])
      : []
    const allTasks = [...activeTasks.filter((t) => isScheduledOn(t, date)), ...archivedDone]
    // One extra query, batched over the day's linked series rather than per task.
    const linkedSeries = [...new Set(allTasks.map((t) => t.goal_series_id).filter(Boolean))] as string[]
    if (linkedSeries.length > 0) {
      const { data: linkedGoalRows } = await supabase.from('goals').select('*').in('series_id', linkedSeries)
      // A series has one row per period; the one that matters today is the one whose period
      // contains this day — the same containment rule the rollup uses.
      const current = new Map<string, Goal>()
      for (const g of (linkedGoalRows ?? []) as Goal[]) {
        if (g.period_start > date) continue
        if (periodEndISO(g.period_type, g.period_start) < date) continue
        const existing = current.get(g.series_id)
        // Prefer the tightest horizon: a weekly goal says more about today than a yearly one.
        if (!existing || PERIOD_TYPES.indexOf(g.period_type) < PERIOD_TYPES.indexOf(existing.period_type)) {
          current.set(g.series_id, g)
        }
      }
      const resolved = await Promise.all(
        [...current.values()].map(async (goal) => {
          const { progress, isRollup } = await resolveGoalProgress(goal)
          return [
            goal.series_id,
            { goal, progress, pace: goalPace(goal, progress), done: isGoalDone(goal, progress, isRollup) },
          ] as const
        }),
      )
      setTaskGoals(new Map(resolved))
    } else {
      setTaskGoals(new Map())
    }
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
    setAllTasks(activeTasks)
    setUpcoming((upcomingRows ?? []) as DailyTask[])
    const byTask = new Map<string, Set<string>>()
    for (const r of historyRows ?? []) {
      const set = byTask.get(r.task_id) ?? new Set<string>()
      set.add(r.date)
      byTask.set(r.task_id, set)
    }
    for (const t of toAutoComplete) (byTask.get(t.id) ?? byTask.set(t.id, new Set()).get(t.id)!).add(date)
    setHistory(byTask)
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
    setNewRepeatDays(null)
    setNewScheduledDate(viewDate)
    setReminderId(null)
    setReminderTime('')
    setReminderEnabled(true)
    setReminderDays([])
  }

  // "More" on the quick-add bar: the full form, carrying over what was typed and picked.
  function openAddForm() {
    resetForm()
    setNewTitle(quickTitle.trim())
    setNewRecurring(when.repeat)
    setNewRepeatDays(when.repeat ? when.days : null)
    setNewScheduledDate(shiftISO(viewDate, when.repeat ? 0 : when.offset))
    setAddFormOpen(true)
  }

  // One line and a "when" chip is all a new task needs; the full form is for the rest.
  async function quickAdd(e: React.FormEvent) {
    e.preventDefault()
    const title = quickTitle.trim()
    if (!title) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    setQuickTitle('')
    await supabase.from('daily_tasks').insert({
      title,
      user_id: user.id,
      recurring: when.repeat,
      repeat_days: when.repeat ? when.days : null,
      scheduled_date: shiftISO(viewDate, when.repeat ? 0 : when.offset),
    })
    load()
  }


  function openEditForm(task: DailyTask) {
    setEditingTask(task)
    setNewTitle(task.title)
    setNewCategoryId(task.category_id ?? '')
    setNewGoalSeriesId(task.goal_series_id ?? '')
    setNewAutoMetric(task.auto_metric ?? '')
    setNewAutoMetricTarget(task.auto_metric_target != null ? String(task.auto_metric_target) : '')
    setNewRecurring(task.recurring)
    setNewRepeatDays(task.repeat_days?.length ? task.repeat_days : null)
    setNewScheduledDate(task.scheduled_date ?? '')
    const reminder = reminders.find((r) => r.task_id === task.id)
    setReminderId(reminder?.id ?? null)
    setReminderTime(reminder ? reminder.time_of_day.slice(0, 5) : '')
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
      // Every day is stored as null, not all seven — one spelling for "no restriction".
      repeat_days: newRecurring && newRepeatDays?.length && newRepeatDays.length < 7 ? newRepeatDays : null,
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
            time_of_day: reminderTime,
            enabled: reminderEnabled,
            days_of_week: finalReminderDays,
          })
          .eq('id', reminderId)
      }
    } else if (reminderTime) {
      await supabase.from('reminders').insert({
        label: newTitle.trim(),
        time_of_day: reminderTime,
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
    const markHistory = (done: boolean) =>
      setHistory((h) => {
        const set = new Set(h.get(task.id) ?? [])
        if (done) set.add(date)
        else set.delete(date)
        return new Map(h).set(task.id, set)
      })
    if (isDone) {
      next.delete(task.id)
      setCompletedIds(next)
      markHistory(false)
      await supabase.from('task_completions').delete().eq('task_id', task.id).eq('date', date)
      await bumpLinkedGoal(task, -1)
      if (!task.recurring) {
        await supabase.from('daily_tasks').update({ active: true }).eq('id', task.id)
        await supabase.from('reminders').update({ enabled: true }).eq('task_id', task.id)
      }
    } else {
      next.add(task.id)
      setCompletedIds(next)
      markHistory(true)
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
  const remainingCount = tasks.length - doneCount
  const habits = tasks.filter((t) => t.recurring)
  const todos = tasks.filter((t) => !t.recurring)
  // Settings' step goal wins, but a "walk N steps" task carries the same intent — fall
  // back to its target so the steps ring works without setting the goal in two places.
  const stepTaskTarget = tasks.find((t) => t.auto_metric === 'steps')?.auto_metric_target ?? null
  const effectiveStepGoal = stepGoal ?? stepTaskTarget
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const metricEntryInfo = metricEntryTask && isAutoMetric(metricEntryTask.auto_metric) ? METRIC_INFO[metricEntryTask.auto_metric] : null
  // Reminders follow the task's own days: a Mon/Wed/Fri habit reminds Mon/Wed/Fri, a
  // one-time task on the weekday it's scheduled for.
  const defaultReminderDays = newRecurring
    ? (newRepeatDays ?? [0, 1, 2, 3, 4, 5, 6])
    : [getDay(new Date((newScheduledDate || viewDate) + 'T00:00:00'))]
  const activeReminderDays = reminderDays.length ? reminderDays : defaultReminderDays

  const dayPct = tasks.length ? (doneCount / tasks.length) * 100 : 0

  // The week strip: each day's ring is completions over what was due — the habits planned
  // for that weekday plus any one-time task finished on it.
  const weekDays = Array.from({ length: 7 }, (_, i) => shiftISO(weekStart, i))
  const doneOn = (d: string) => [...history.values()].filter((set) => set.has(d)).length
  const habitsOn = (d: string) =>
    allTasks.filter(
      (t) => t.recurring && t.auto_metric !== CALORIE_BUDGET_METRIC && isScheduledOn(t, d) && (t.scheduled_date ?? t.created_at.slice(0, 10)) <= d,
    ).length
  const thisWeek = weekStart === weekStartISO(new Date())

  // One task row: the check on the left, then title and a line of detail. Tapping the text
  // opens it for editing; the check ticks it (or, for a metric task, enters its value).
  function renderTask(task: DailyTask) {
    const isBudget = task.auto_metric === CALORIE_BUDGET_METRIC
    const done = isTaskDone(task)
    const category = task.category_id ? categoryById.get(task.category_id) : undefined
    const style = category ? CATEGORY_STYLES[category.color] : CATEGORY_STYLES.violet
    const linked = task.goal_series_id ? taskGoals.get(task.goal_series_id) : undefined
    const verdict = linked ? paceVerdict(linked.goal, linked.pace) : null
    const metric = isAutoMetric(task.auto_metric) ? task.auto_metric : null
    const metricInfo = metric ? METRIC_INFO[metric] : null
    const metricValue = metric ? (metricValues.get(metric) ?? 0) : null
    const metricPct = metric && metricValue != null && task.auto_metric_target ? Math.min(100, (metricValue / task.auto_metric_target) * 100) : null
    const metricRemaining = metric && metricValue != null && task.auto_metric_target ? task.auto_metric_target - metricValue : null
    const start = task.scheduled_date ?? task.created_at.slice(0, 10)
    const isLate = !task.recurring && !done && start < viewDate
    const dots = task.recurring && !isBudget ? habitHistory(task, history.get(task.id) ?? new Set(), date) : []
    const onCheck = () => (metric ? openMetricEntry(task) : isBudget ? undefined : toggle(task))

    let detail: React.ReactNode
    if (metricPct != null) {
      detail = (
        <span className="flex items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
            <span className="block h-full rounded-full" style={{ width: `${metricPct}%`, background: style.accent }} />
          </span>
          <span className="shrink-0 text-[11px] font-semibold" style={{ color: style.ink }}>
            {metricRemaining! > 0 ? `${metricRemaining!.toLocaleString()} to go` : 'goal met'}
          </span>
        </span>
      )
    } else if (isBudget) {
      detail = (
        <span className="text-[11px] font-semibold" style={{ color: style.ink }}>
          {(todayCalories ?? 0).toLocaleString()}
          {task.auto_metric_target != null && ` / ${task.auto_metric_target.toLocaleString()}`} kcal
        </span>
      )
    } else if (metricInfo) {
      detail = <span className="text-[11px] font-semibold" style={{ color: style.ink }}>{`${metricValue?.toLocaleString()} ${metricInfo.unit}`}</span>
    } else {
      const parts = [
        category?.name,
        task.recurring && task.repeat_days?.length ? repeatLabel(task.repeat_days) : null,
        !task.recurring ? (isLate ? `late · from ${format(new Date(start + 'T00:00:00'), 'EEE d MMM')}` : null) : null,
      ].filter(Boolean)
      detail = (
        <span className={`truncate text-[11px] font-medium ${isLate ? 'text-cat-rose-ink' : 'text-ink-muted'}`}>{parts.join(' · ')}</span>
      )
    }

    return (
      <li key={task.id} className={`flex items-center gap-3 rounded-[20px] border border-line bg-surface py-3 pr-3 pl-3 shadow-card ${done ? 'opacity-70' : ''}`}>
        <button
          onClick={onCheck}
          aria-label={done ? 'Mark not done' : 'Mark done'}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base transition active:scale-90"
          style={done ? { background: style.check } : { border: `2px solid ${style.accent}66`, background: style.tint }}
        >
          {done ? (
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] text-white" fill="none">
              <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : isBudget ? (
            '🔥'
          ) : metricInfo ? (
            metricInfo.icon
          ) : null}
        </button>
        <button onClick={() => openEditForm(task)} className="flex min-w-0 flex-1 flex-col gap-1 text-left">
          <span className={`line-clamp-2 text-[15px] leading-snug ${done ? 'text-ink-muted line-through' : 'font-medium text-ink'}`}>{task.title}</span>
          {detail}
          {linked && (
            <span className="truncate text-[11px] font-medium" style={{ color: verdict?.tone === 'behind' ? '#a33327' : THEME.ink2 }}>
              → {linked.goal.title}
              {verdict ? ` · ${verdict.label}` : ''}
            </span>
          )}
          {dots.length > 0 && (
            <span className="flex items-center gap-[3px]" title="Last 7 times it was due">
              {dots.map((d, i) => (
                <span key={i} className="h-[7px] w-[7px] rounded-full" style={{ background: d ? style.accent : THEME.line }} />
              ))}
              <span className="ml-1 text-[10px] font-semibold" style={{ color: style.ink }}>
                {dots.filter(Boolean).length}/{dots.length}
              </span>
            </span>
          )}
        </button>
      </li>
    )
  }

  function section(label: string, list: DailyTask[]) {
    if (!list.length) return null
    const done = list.filter(isTaskDone)
    return (
      <>
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-semibold tracking-[0.07em] text-ink-3">{label}</span>
          <span className="text-[11px] font-semibold text-ink-disabled">
            {done.length}/{list.length}
          </span>
          <span className="h-px flex-1 bg-line-strong" />
        </div>
        <ul className="flex flex-col gap-2">{[...list.filter((t) => !isTaskDone(t)), ...done].map(renderTask)}</ul>
      </>
    )
  }

  const hero = (
    <>
      <div className="mt-3 flex items-center gap-3.5">
        <ProgressRing percent={dayPct} size={64} strokeWidth={6} color="#fff" trackColor="rgba(255,255,255,.2)">
          <span className="text-sm font-semibold text-white">
            {doneCount}/{tasks.length}
          </span>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold text-white">
            {tasks.length === 0 ? 'Nothing planned' : remainingCount === 0 ? 'All done' : `${remainingCount} left${isToday ? ' today' : ''}`}
          </p>
          <p className="mt-0.5 text-xs font-medium text-white/75">
            {habits.length} habit{habits.length === 1 ? '' : 's'} · {todos.length} to-do{todos.length === 1 ? '' : 's'}
            {upcoming.length > 0 && ` · ${upcoming.length} coming up`}
          </p>
        </div>
      </div>

      {(steps != null || weightToday != null || todayCalories != null) && (
        <button onClick={() => setSummaryOpen((o) => !o)} className="mt-3 flex flex-wrap gap-1.5 text-left">
          {steps != null && (
            <HeroChip>
              🚶 {steps.toLocaleString()}
              {effectiveStepGoal ? ` / ${effectiveStepGoal.toLocaleString()}` : ''}
            </HeroChip>
          )}
          {weightToday != null && <HeroChip>⚖️ {weightToday} kg</HeroChip>}
          {todayCalories != null && <HeroChip>🔥 {todayCalories.toLocaleString()} kcal</HeroChip>}
        </button>
      )}

      {/* The week as a strip of days, each ringed by how much of it got done — tap one to
          plan or review it. Arrows page by week. */}
      <div className="mt-3.5 flex items-center gap-1 rounded-[18px] bg-white/12 px-1.5 py-2">
        <button
          onClick={() => setViewDate((d) => shiftISO(d, -7))}
          aria-label="Previous week"
          className="flex h-7 w-6 shrink-0 items-center justify-center text-white/80"
        >
          ‹
        </button>
        {weekDays.map((d) => {
          const due = habitsOn(d)
          const done = doneOn(d)
          const past = d <= todayISO()
          const pct = !past ? 0 : due ? Math.min(100, (done / due) * 100) : done ? 100 : 0
          const selected = d === viewDate
          return (
            <button key={d} onClick={() => setViewDate(d)} className="flex flex-1 flex-col items-center gap-1">
              <span className={`text-[10px] font-semibold ${selected ? 'text-white' : 'text-white/65'}`}>
                {format(new Date(d + 'T00:00:00'), 'EEEEE')}
              </span>
              <ProgressRing percent={pct} size={32} strokeWidth={3} color="#fff" trackColor="rgba(255,255,255,.18)" disc={selected ? '#fdfbf6' : undefined}>
                <span className={`text-[11px] font-semibold ${selected ? 'text-pine' : d === todayISO() ? 'text-white underline' : 'text-white'}`}>
                  {format(new Date(d + 'T00:00:00'), 'd')}
                </span>
              </ProgressRing>
            </button>
          )
        })}
        <button
          onClick={() => setViewDate((d) => shiftISO(d, 7))}
          aria-label="Next week"
          className="flex h-7 w-6 shrink-0 items-center justify-center text-white/80"
        >
          ›
        </button>
      </div>
      {(!thisWeek || !isToday) && (
        <button onClick={() => setViewDate(todayISO())} className="mt-2 text-xs font-semibold text-white/85">
          {format(new Date(viewDate + 'T00:00:00'), 'EEEE d MMMM')} · back to today ›
        </button>
      )}
    </>
  )

  return (
    <Screen
      title="Today"
      onRefresh={load}
      hero={hero}
      titleAside={
        checkinDone != null && (
          <button
            onClick={() => setCheckinOpen(true)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-white ${checkinDone ? 'bg-[#3f9a6b]' : 'bg-cat-rose'}`}
          >
            {checkinDone ? '✓ Check-in' : 'Check-in'}
          </button>
        )
      }
    >
      {checkinOpen && <DailyCheckin date={checkinDate} onClose={() => setCheckinOpen(false)} onSaved={loadCheckin} />}
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

      {/* Quick add: type, pick when, Enter. "More" opens the full form with both carried over. */}
      <form onSubmit={quickAdd} className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-surface p-3 shadow-card">
        <div className="flex items-center gap-2">
          <input
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            placeholder={when.repeat ? 'New habit…' : 'Add a to-do…'}
            enterKeyHint="done"
            className="min-w-0 flex-1 bg-transparent px-1 text-[15px] text-ink placeholder-ink-disabled outline-none"
          />
          <button
            type="submit"
            disabled={!quickTitle.trim()}
            aria-label="Add"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pine text-lg font-semibold text-white disabled:opacity-35"
          >
            +
          </button>
        </div>
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {quickWhens().map((w) => {
            const editWhen = () => setWhenSheet(findOption('quick_when', w.key) ?? null)
            return (
              <span key={w.key} className="flex shrink-0 items-center gap-1">
                <Pressable
                  type="button"
                  onLongPress={editWhen}
                  onClick={() => setQuickWhen(w.key)}
                  className={`rounded-full px-3 py-1.5 text-xs transition ${
                    when.key === w.key ? 'bg-pine font-semibold text-white' : 'border border-line bg-page font-medium text-ink-2'
                  }`}
                >
                  {/* "Today" reads as the day itself when another day is shown. */}
                  {!w.repeat && w.offset === 0 && !isToday ? format(new Date(viewDate + 'T00:00:00'), 'EEE d') : w.label}
                </Pressable>
                {editing && <EditDots onClick={editWhen} label={w.label} />}
              </span>
            )
          })}
          {editing && (
            <button type="button" onClick={() => setWhenSheet('new')} className="shrink-0 rounded-full border border-dashed border-line-strong px-3 py-1.5 text-xs font-medium text-pine">
              + New
            </button>
          )}
          <button type="button" onClick={openAddForm} className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-pine">
            More…
          </button>
        </div>
      </form>
      {whenSheet && (
        <OptionSheet
          kind="quick_when"
          row={whenSheet === 'new' ? null : whenSheet}
          noun="quick choice"
          noIcon
          newMeta={{ repeat: false, offset: 0, days: null }}
          onClose={() => setWhenSheet(null)}
          fields={(meta, set) => {
            const repeat = meta.repeat === true
            const days = Array.isArray(meta.days) ? (meta.days as number[]) : null
            return (
              <>
                <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-page p-1">
                  {[false, true].map((r) => (
                    <button
                      key={String(r)}
                      type="button"
                      onClick={() => set({ repeat: r })}
                      className={`rounded-xl py-2 text-xs ${repeat === r ? 'bg-surface font-semibold text-pine-dark shadow-card' : 'font-medium text-ink-3'}`}
                    >
                      {r ? 'Habit (repeats)' : 'To-do (once)'}
                    </button>
                  ))}
                </div>
                {repeat ? (
                  <div className="flex gap-1">
                    {WEEK_ORDER.map((d) => {
                      const on = days == null || days.includes(d)
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => {
                            const current = days ?? WEEK_ORDER
                            const next = on ? current.filter((x) => x !== d) : [...current, d].sort()
                            // All seven = every day (null), like the full form.
                            set({ days: next.length === 7 ? null : next })
                          }}
                          className={`flex-1 rounded-xl py-1.5 text-xs font-medium ${on ? 'bg-cat-emerald-tint text-pine' : 'bg-track text-ink-disabled'}`}
                        >
                          {DAY_LABELS[d].charAt(0)}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <label className="flex items-center gap-2 text-[13px] text-ink-2">
                    On the day shown +
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={String(meta.offset ?? 0)}
                      onChange={(e) => set({ offset: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                      className="w-16 rounded-xl border border-line bg-page px-2 py-1.5 text-center text-sm font-semibold text-ink outline-none focus:border-pine"
                    />
                    days
                  </label>
                )}
              </>
            )
          }}
        />
      )}

      {loading ? (
        <p className="text-sm text-ink-disabled">Loading…</p>
      ) : tasks.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-line-strong px-4 py-5 text-center">
          <p className="text-sm font-semibold text-ink-2">A blank {isToday ? 'day' : 'page'}</p>
          <p className="mt-1 text-xs text-ink-muted">
            Add a to-do above, or a habit that comes back every day.
          </p>
        </div>
      ) : (
        <>
          {section('HABITS', habits)}
          {section('TO-DOS', todos)}
        </>
      )}

      {upcoming.length > 0 && (
        <>
          <div className="mt-1 flex items-center gap-2.5">
            <span className="text-[11px] font-semibold tracking-[0.07em] text-ink-3">COMING UP</span>
            <span className="h-px flex-1 bg-line-strong" />
          </div>
          <div className="flex flex-col overflow-hidden rounded-[20px] border border-line bg-surface">
            {upcoming.map((t, i) => (
              <button
                key={t.id}
                onClick={() => setViewDate(t.scheduled_date!)}
                className={`flex items-center gap-3 px-3.5 py-2.5 text-left ${i > 0 ? 'border-t border-line' : ''}`}
              >
                <span className="w-[54px] shrink-0 text-[11px] font-semibold text-ink-3">
                  {t.scheduled_date === shiftISO(date, 1) ? 'Tomorrow' : format(new Date(t.scheduled_date + 'T00:00:00'), 'EEE d')}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{t.title}</span>
                <span className="shrink-0 text-xs text-ink-faint">›</span>
              </button>
            ))}
          </div>
        </>
      )}

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
              placeholder="What needs doing?"
              className="rounded-[20px] border border-line bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
            />
            <LabelPicker
              labels={categories}
              setLabels={setCategories}
              value={newCategoryId || null}
              onChange={(id) => setNewCategoryId(id ?? '')}
              onRefsChanged={load}
            />
            <div className="flex gap-2">
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
            {/* Repeat: once (on a date, carried over until done), or on chosen weekdays. */}
            <span className="mt-1 text-xs font-semibold text-ink-3">Repeat</span>
            <div className="flex gap-1 rounded-[20px] bg-track p-1">
              {(
                [
                  ['once', 'Once'],
                  ['daily', 'Every day'],
                  ['weekdays', 'Weekdays'],
                  ['custom', 'Custom'],
                ] as const
              ).map(([id, label]) => {
                const mode = !newRecurring
                  ? 'once'
                  : !newRepeatDays
                    ? 'daily'
                    : repeatLabel(newRepeatDays) === 'Weekdays'
                      ? 'weekdays'
                      : 'custom'
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setNewRecurring(id !== 'once')
                      setNewRepeatDays(id === 'weekdays' ? WEEKDAYS : id === 'custom' ? (newRepeatDays ?? [1, 3, 5]) : null)
                      setReminderDays([])
                    }}
                    className={`flex-1 rounded-xl px-1 py-2 text-xs font-medium transition ${mode === id ? 'bg-surface text-pine shadow-card' : 'text-ink-3'}`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {newRecurring && newRepeatDays && (
              <div className="flex gap-1">
                {WEEK_ORDER.map((d) => {
                  const on = newRepeatDays.includes(d)
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        const next = on ? newRepeatDays.filter((x) => x !== d) : [...newRepeatDays, d]
                        setNewRepeatDays(next.length ? next.sort() : newRepeatDays)
                        setReminderDays([])
                      }}
                      className={`flex-1 rounded-xl py-2 text-xs font-semibold ${on ? 'bg-pine text-white' : 'bg-track text-ink-disabled'}`}
                    >
                      {DAY_LABELS[d].charAt(0)}
                    </button>
                  )
                })}
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-sm text-ink-3">{newRecurring ? 'Starts' : 'On'}</span>
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
            {editingTask && (
              <div className="mt-1 flex items-center justify-between px-1">
                <button type="button" onClick={() => setConfirmTask(editingTask)} className="text-sm font-medium text-cat-rose-ink">
                  Remove task
                </button>
                {editingTask.goal_series_id && taskGoals.get(editingTask.goal_series_id) && (
                  <button
                    type="button"
                    onClick={() => {
                      const g = taskGoals.get(editingTask.goal_series_id!)!.goal
                      closeForm()
                      openGoalDetail(g.id)
                    }}
                    className="text-sm font-medium text-pine"
                  >
                    Open linked goal ›
                  </button>
                )}
              </div>
            )}
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

      {/* Reminders and signing out live at the bottom of Today (there's no Settings page). */}
      <Reminders />
      <button onClick={() => supabase.auth.signOut()} className="self-center pb-2 text-xs font-medium text-ink-muted">
        Sign out
      </button>

      <ConfirmDialog
        open={confirmTask !== null}
        title={`Remove "${confirmTask?.title ?? ''}"?`}
        message="This archives the task — it'll no longer show up in your daily list."
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirmTask) removeTask(confirmTask)
          setConfirmTask(null)
          closeForm()
        }}
        onCancel={() => setConfirmTask(null)}
      />
    </Screen>
  )
}
