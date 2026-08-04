import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { weekStartISO } from '../lib/dates'
import type { WeeklyGoal } from '../lib/types'

export function Goals() {
  const [goals, setGoals] = useState<WeeklyGoal[]>([])
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('')
  const [loading, setLoading] = useState(true)
  const weekStart = weekStartISO()

  async function load() {
    setLoading(true)
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
    })
    setTitle('')
    setTarget('')
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
    <div className="flex flex-col gap-4 px-4 pt-4">
      <h1 className="text-xl font-semibold text-slate-100">This week's goals</h1>
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : goals.length === 0 ? (
        <p className="text-sm text-slate-500">No goals yet for this week.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {goals.map((goal) => {
            const pct = goal.target_value ? Math.min(100, (goal.progress / goal.target_value) * 100) : null
            return (
              <li key={goal.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className={`font-medium ${goal.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-100'}`}>
                    {goal.title}
                  </p>
                  <button onClick={() => remove(goal)} className="text-slate-600">
                    ✕
                  </button>
                </div>
                {goal.target_value ? (
                  <>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm text-slate-400">
                      <span>
                        {goal.progress} / {goal.target_value}
                      </span>
                      <div className="flex gap-2">
                        <button onClick={() => bump(goal, -1)} className="rounded-lg bg-slate-800 px-3 py-1">
                          −
                        </button>
                        <button onClick={() => bump(goal, 1)} className="rounded-lg bg-slate-800 px-3 py-1">
                          +
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <button
                    onClick={() =>
                      supabase
                        .from('weekly_goals')
                        .update({ status: goal.status === 'done' ? 'active' : 'done' })
                        .eq('id', goal.id)
                        .then(load)
                    }
                    className="mt-2 text-sm text-indigo-400"
                  >
                    {goal.status === 'done' ? 'Mark as active' : 'Mark as done'}
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
          className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500"
        />
        <div className="flex gap-2">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Target number (optional)"
            type="number"
            className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500"
          />
          <button type="submit" className="rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white">
            Add
          </button>
        </div>
      </form>
    </div>
  )
}
