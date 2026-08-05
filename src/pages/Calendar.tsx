import { useEffect, useState } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, getDay } from 'date-fns'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/dates'
import { CATEGORY_STYLES } from '../lib/categories'
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
    <div className="flex flex-col gap-4 px-4 pt-6 pb-4">
      <h1 className="text-2xl font-bold text-gray-900">Calendar</h1>

      <div className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <button
            onClick={() => setMonthCursor((m) => subMonths(m, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600"
          >
            ‹
          </button>
          <p className="font-semibold text-gray-900">{format(monthCursor, 'MMMM yyyy')}</p>
          <button
            onClick={() => setMonthCursor((m) => addMonths(m, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600"
          >
            ›
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-gray-400">
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
                  isSelected ? 'bg-violet-600 text-white' : isToday ? 'bg-violet-100 text-violet-600 font-semibold' : 'text-gray-700'
                }`}
              >
                {format(day, 'd')}
                <span
                  className={`h-1 w-1 rounded-full ${hasTasks ? (isSelected ? 'bg-white' : 'bg-violet-500') : 'bg-transparent'}`}
                />
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-500">{format(new Date(selectedDate + 'T00:00:00'), 'EEEE, MMM d')}</h2>
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : selectedTasks.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing scheduled for this day.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {selectedTasks.map((task) => {
              const category = task.category_id ? categoryById.get(task.category_id) : undefined
              const style = category ? CATEGORY_STYLES[category.color] : CATEGORY_STYLES.violet
              return (
                <li
                  key={task.id}
                  className="flex items-center justify-between overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
                >
                  <span className={`h-full w-1.5 self-stretch ${style.dot}`} />
                  <div className="flex flex-1 items-center gap-2 px-4 py-3">
                    <span className="font-medium text-gray-900">{task.title}</span>
                    {category && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.bg} ${style.text}`}>
                        {category.name}
                      </span>
                    )}
                    {!task.recurring && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">One-time</span>
                    )}
                  </div>
                  <button onClick={() => removeTask(task)} className="px-4 text-gray-300">
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
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-500">
          <input
            type="checkbox"
            checked={newRecurring}
            onChange={(e) => setNewRecurring(e.target.checked)}
            className="accent-violet-600"
          />
          Keep recurring daily starting this date
        </label>
        <button type="submit" className="rounded-2xl bg-rose-600 px-4 py-2.5 font-semibold text-white">
          Schedule task
        </button>
      </form>
    </div>
  )
}
