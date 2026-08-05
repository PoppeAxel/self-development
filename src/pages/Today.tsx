import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/dates'
import { ProgressRing } from '../components/ProgressRing'
import type { DailyTask } from '../lib/types'

const ACCENTS = [
  { bar: 'bg-pink-400', dot: 'border-pink-500 bg-pink-500' },
  { bar: 'bg-amber-400', dot: 'border-amber-500 bg-amber-500' },
  { bar: 'bg-violet-400', dot: 'border-violet-500 bg-violet-500' },
  { bar: 'bg-emerald-400', dot: 'border-emerald-500 bg-emerald-500' },
]

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

  const doneCount = tasks.filter((t) => completedIds.has(t.id)).length
  const pct = tasks.length ? (doneCount / tasks.length) * 100 : 0

  return (
    <div className="flex flex-col gap-4 px-4 pt-6 pb-2">
      <h1 className="text-2xl font-bold text-gray-900">Manage Your Daily Tasks</h1>

      {tasks.length > 0 && (
        <div className="flex items-center gap-4 rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
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

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-gray-400">No daily tasks yet. Add one below.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.map((task, i) => {
            const done = completedIds.has(task.id)
            const accent = ACCENTS[i % ACCENTS.length]
            return (
              <li
                key={task.id}
                className="flex items-center justify-between overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm"
              >
                <span className={`h-full w-1.5 self-stretch ${accent.bar}`} />
                <button onClick={() => toggle(task)} className="flex flex-1 items-center gap-3 px-4 py-3.5 text-left">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                      done ? accent.dot : 'border-gray-300'
                    }`}
                  >
                    {done && (
                      <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="none">
                        <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className={done ? 'text-gray-400 line-through' : 'font-medium text-gray-900'}>{task.title}</span>
                </button>
                <button onClick={() => removeTask(task)} className="px-4 text-gray-300">
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
          className="flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-violet-400"
        />
        <button type="submit" className="rounded-2xl bg-violet-600 px-4 py-2.5 font-semibold text-white">
          Add
        </button>
      </form>
    </div>
  )
}
