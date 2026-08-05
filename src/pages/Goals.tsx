import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { weekStartISO } from '../lib/dates'
import { rolloverRecurringGoals } from '../lib/goals'
import { ProgressRing } from '../components/ProgressRing'
import { RefreshButton } from '../components/RefreshButton'
import type { WeeklyGoal } from '../lib/types'

export function Goals() {
  const [goals, setGoals] = useState<WeeklyGoal[]>([])
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('')
  const [recurring, setRecurring] = useState(false)
  const [loading, setLoading] = useState(true)
  const weekStart = weekStartISO()

  async function load() {
    setLoading(true)
    await rolloverRecurringGoals()
    const { data } = await supabase
      .from('weekly_goals')
      .select('*')
      .eq('week_start', weekStart)
      .order('created_at')
    setGoals(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addGoal(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('weekly_goals').insert({
      title: title.trim(),
      target_value: target ? Number(target) : null,
      week_start: weekStart,
      user_id: user.id,
      recurring,
    })
    setTitle('')
    setTarget('')
    setRecurring(false)
    load()
  }

  async function bump(goal: WeeklyGoal, delta: number) {
    const progress = Math.max(0, goal.progress + delta)
    const status = goal.target_value && progress >= goal.target_value ? 'done' : 'active'
    setGoals((gs) => gs.map((g) => (g.id === goal.id ? { ...g, progress, status } : g)))
    await supabase.from('weekly_goals').update({ progress, status }).eq('id', goal.id)
  }

  async function remove(goal: WeeklyGoal) {
    setGoals((gs) => gs.filter((g) => g.id !== goal.id))
    await supabase.from('weekly_goals').delete().eq('id', goal.id)
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-6 pb-2">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">This Week's Goals</h1>
        <RefreshButton onRefresh={load} />
      </div>
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : goals.length === 0 ? (
        <p className="text-sm text-gray-400">No goals yet for this week.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {goals.map((goal) => {
            const pct = goal.target_value ? Math.min(100, (goal.progress / goal.target_value) * 100) : 0
            const done = goal.status === 'done'
            return (
              <li key={goal.id} className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className={`font-semibold ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{goal.title}</p>
                    <span
                      className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        done ? 'bg-emerald-100 text-emerald-600' : 'bg-pink-100 text-pink-600'
                      }`}
                    >
                      {done ? 'Done' : 'Active'}
                    </span>
                    {goal.recurring && (
                      <span className="ml-1.5 mt-1 inline-block rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-600">
                        ↻ Weekly
                      </span>
                    )}
                  </div>
                  <button onClick={() => remove(goal)} className="text-gray-300">
                    ✕
                  </button>
                </div>
                {goal.target_value ? (
                  <div className="mt-3 flex items-center gap-4">
                    <ProgressRing percent={pct} size={56} strokeWidth={6} color="#d97706" trackColor="#fef3c7">
                      <span className="text-xs font-bold text-gray-900">{Math.round(pct)}%</span>
                    </ProgressRing>
                    <div className="flex flex-1 items-center justify-between">
                      <span className="text-sm text-gray-500">
                        {goal.progress} / {goal.target_value}
                      </span>
                      <div className="flex gap-2">
                        <button onClick={() => bump(goal, -1)} className="h-8 w-8 rounded-full bg-gray-100 font-semibold text-gray-600">
                          −
                        </button>
                        <button onClick={() => bump(goal, 1)} className="h-8 w-8 rounded-full bg-violet-100 font-semibold text-violet-600">
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() =>
                      supabase
                        .from('weekly_goals')
                        .update({ status: done ? 'active' : 'done' })
                        .eq('id', goal.id)
                        .then(load)
                    }
                    className="mt-3 text-sm font-medium text-violet-600"
                  >
                    {done ? 'Mark as active' : 'Mark as done'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <form onSubmit={addGoal} className="flex flex-col gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New weekly goal"
          className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-violet-400"
        />
        <div className="flex gap-2">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Target number (optional)"
            type="number"
            className="flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-violet-400"
          />
          <button type="submit" className="rounded-2xl bg-violet-600 px-4 py-2.5 font-semibold text-white">
            Add
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-500">
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="accent-violet-600" />
          Recurring every week
        </label>
      </form>
    </div>
  )
}
