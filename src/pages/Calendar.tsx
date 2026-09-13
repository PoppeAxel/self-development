import { useEffect, useState } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, getDay } from 'date-fns'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/dates'
import { CATEGORY_STYLES } from '../lib/categories'
import { Screen } from '../components/Screen'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { Category, DailyTask } from '../lib/types'

export function Calendar() {
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()))
  const [selectedDate, setSelectedDate] = useState(todayISO())
  const [tasks, setTasks] = useState<DailyTask[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [newTitle, setNewTitle] = useState('')
  const [newCategoryId, setNewCategoryId] = useState('')
  const [newRecurring, setNewRecurring] = useState(false)
  const [loading, setLoading] = useState(true)
  const [confirmTask, setConfirmTask] = useState<DailyTask | null>(null)

  async function load() {
    setLoading(true)
    const monthStart = format(monthCursor, 'yyyy-MM-dd')
    const monthEnd = format(endOfMonth(monthCursor), 'yyyy-MM-dd')
    const [{ data: taskRows }, { data: categoryRows }] = await Promise.all([
      supabase
        .from('daily_tasks')
        .select('*')
        .eq('active', true)
        .gte('scheduled_date', monthStart)
        .lte('scheduled_date', monthEnd)
        .order('scheduled_date'),
      supabase.from('categories').select('*').order('name'),
    ])
    setTasks(taskRows ?? [])
    setCategories(categoryRows ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthCursor])

  async function addTask(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim()) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('daily_tasks').insert({
      title: newTitle.trim(),
      user_id: user.id,
      category_id: newCategoryId || null,
      recurring: newRecurring,
      scheduled_date: selectedDate,
    })
    setNewTitle('')
    setNewCategoryId('')
    setNewRecurring(false)
    load()
  }

  async function removeTask(task: DailyTask) {
    setTasks((ts) => ts.filter((t) => t.id !== task.id))
    await supabase.from('daily_tasks').update({ active: false }).eq('id', task.id)
  }

  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const tasksByDate = new Map<string, DailyTask[]>()
  for (const t of tasks) {
    if (!t.scheduled_date) continue
    const arr = tasksByDate.get(t.scheduled_date) ?? []
    arr.push(t)
    tasksByDate.set(t.scheduled_date, arr)
  }

  const days = eachDayOfInterval({ start: monthCursor, end: endOfMonth(monthCursor) })
  const leadingBlanks = (getDay(monthCursor) + 6) % 7 // Monday-first offset
  const today = todayISO()
  const selectedTasks = tasksByDate.get(selectedDate) ?? []

  return (
    <Screen title="Calendar" onRefresh={load}>

      <div className="rounded-3xl border border-line bg-surface p-4 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <button
            onClick={() => setMonthCursor((m) => subMonths(m, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-track text-ink-2"
          >
            ‹
          </button>
          <p className="font-semibold text-ink">{format(monthCursor, 'MMMM yyyy')}</p>
          <button
            onClick={() => setMonthCursor((m) => addMonths(m, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-track text-ink-2"
          >
            ›
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-ink-disabled">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {days.map((day) => {
            const iso = format(day, 'yyyy-MM-dd')
            const hasTasks = tasksByDate.has(iso)
            const isToday = iso === today
            const isSelected = iso === selectedDate
            return (
              <button
                key={iso}
                onClick={() => setSelectedDate(iso)}
                className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-sm ${
                  isSelected ? 'bg-pine text-white' : isToday ? 'bg-cat-emerald-tint text-pine font-semibold' : 'text-ink-2'
                }`}
              >
                {format(day, 'd')}
                <span
                  className={`h-1 w-1 rounded-full ${hasTasks ? (isSelected ? 'bg-surface' : 'bg-pine') : 'bg-transparent'}`}
                />
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-ink-3">{format(new Date(selectedDate + 'T00:00:00'), 'EEEE, MMM d')}</h2>
        {loading ? (
          <p className="text-sm text-ink-disabled">Loading…</p>
        ) : selectedTasks.length === 0 ? (
          <p className="text-sm text-ink-disabled">Nothing scheduled for this day.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {selectedTasks.map((task) => {
              const category = task.category_id ? categoryById.get(task.category_id) : undefined
              const style = category ? CATEGORY_STYLES[category.color] : CATEGORY_STYLES.violet
              return (
                <li
                  key={task.id}
                  className="flex items-center justify-between overflow-hidden rounded-[20px] border border-line bg-surface shadow-card"
                >
                  <span className={`h-full w-1.5 self-stretch ${style.dot}`} />
                  <div className="flex flex-1 items-center gap-2 px-4 py-3">
                    <span className="font-medium text-ink">{task.title}</span>
                    {category && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.bg} ${style.text}`}>
                        {category.name}
                      </span>
                    )}
                    {!task.recurring && (
                      <span className="rounded-full bg-track px-2 py-0.5 text-[11px] font-medium text-ink-3">One-time</span>
                    )}
                  </div>
                  <button onClick={() => setConfirmTask(task)} className="px-4 text-ink-faint">
                    ✕
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <form onSubmit={addTask} className="flex flex-col gap-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder={`Add a task for ${format(new Date(selectedDate + 'T00:00:00'), 'MMM d')}`}
          className="rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
        />
        <div className="flex gap-2">
          <select
            value={newCategoryId}
            onChange={(e) => setNewCategoryId(e.target.value)}
            className="flex-1 rounded-[20px] border border-line-strong bg-surface px-3 py-2.5 text-ink outline-none focus:border-pine"
          >
            <option value="">No label</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-3">
          <input
            type="checkbox"
            checked={newRecurring}
            onChange={(e) => setNewRecurring(e.target.checked)}
            className="accent-pine"
          />
          Keep recurring daily starting this date
        </label>
        <button type="submit" className="rounded-[20px] bg-pine px-4 py-2.5 font-semibold text-white">
          Schedule task
        </button>
      </form>

      <ConfirmDialog
        open={confirmTask !== null}
        title={`Remove "${confirmTask?.title ?? ''}"?`}
        message="This archives the task — it'll no longer show up on this day."
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
