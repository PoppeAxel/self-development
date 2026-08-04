import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/dates'
import type { DailyTask } from '../lib/types'

export function Today() {
  const [tasks, setTasks] = useState<DailyTask[]>([])
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())
  const [newTitle, setNewTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const date = todayISO()

  async function load() {
    setLoading(true)
    const [{ data: taskRows }, { data: completionRows }] = await Promise.all([
      supabase.from('daily_tasks').select('*').eq('active', true).order('created_at'),
      supabase.from('task_completions').select('task_id').eq('date', date),
    ])
    setTasks(taskRows ?? [])
    setCompletedIds(new Set((completionRows ?? []).map((r) => r.task_id)))
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addTask(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim()) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('daily_tasks').insert({ title: newTitle.trim(), user_id: user.id })
    setNewTitle('')
    load()
  }

  async function toggle(task: DailyTask) {
    const isDone = completedIds.has(task.id)
    const next = new Set(completedIds)
    if (isDone) {
      next.delete(task.id)
      setCompletedIds(next)
      await supabase.from('task_completions').delete().eq('task_id', task.id).eq('date', date)
    } else {
      next.add(task.id)
      setCompletedIds(next)
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('task_completions').insert({ task_id: task.id, date, user_id: user.id })
    }
  }

  async function removeTask(task: DailyTask) {
    await supabase.from('daily_tasks').update({ active: false }).eq('id', task.id)
    load()
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <h1 className="text-xl font-semibold text-slate-100">Today</h1>
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-slate-500">No daily tasks yet. Add one below.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => {
            const done = completedIds.has(task.id)
            return (
              <li
                key={task.id}
                className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-3"
              >
                <button onClick={() => toggle(task)} className="flex flex-1 items-center gap-3 text-left">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                      done ? 'border-indigo-500 bg-indigo-500' : 'border-slate-600'
                    }`}
                  >
                    {done && (
                      <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="none">
                        <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className={done ? 'text-slate-500 line-through' : 'text-slate-100'}>{task.title}</span>
                </button>
                <button onClick={() => removeTask(task)} className="px-2 text-slate-600">
                  ✕
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <form onSubmit={addTask} className="flex gap-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="New daily task"
          className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500"
        />
        <button type="submit" className="rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white">
          Add
        </button>
      </form>
    </div>
  )
}
