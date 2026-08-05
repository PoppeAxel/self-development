import { useEffect, useState } from 'react'
import { BarChart, Bar, LineChart, Line, ReferenceLine, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { format, subDays, parseISO, differenceInCalendarDays } from 'date-fns'
import { supabase } from '../lib/supabase'
import { todayISO, weekStartISO } from '../lib/dates'
import { CATEGORY_STYLES } from '../lib/categories'
import type { Category, DailyTask, WeeklyGoal } from '../lib/types'

interface Streak {
  task: DailyTask
  current: number
  best: number
}

function WeightChart({
  data,
  goalWeight,
  height,
}: {
  data: { date: string; value: number }[]
  goalWeight: number | null
  height: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f0f7" />
        <XAxis dataKey="date" stroke="#9ca3af" fontSize={11} />
        <YAxis
          stroke="#9ca3af"
          fontSize={11}
          domain={[
            (dataMin: number) => Math.floor(Math.min(dataMin, goalWeight ?? dataMin) - 2),
            (dataMax: number) => Math.ceil(Math.max(dataMax, goalWeight ?? dataMax) + 2),
          ]}
        />
        <Tooltip contentStyle={{ background: '#fff', border: '1px solid #f1f0f7', fontSize: 12, borderRadius: 12 }} />
        {goalWeight != null && (
          <ReferenceLine
            y={goalWeight}
            stroke="#059669"
            strokeWidth={2}
            strokeDasharray="6 4"
            ifOverflow="extendDomain"
            label={{ value: `Goal ${goalWeight}kg`, fontSize: 12, fontWeight: 600, fill: '#059669', position: 'insideTopLeft' }}
          />
        )}
        <Line type="monotone" dataKey="value" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 3, fill: '#7c3aed' }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function computeStreaks(tasks: DailyTask[], completionsByTask: Map<string, string[]>): Streak[] {
  const today = todayISO()
  return tasks.map((task) => {
    const dates = completionsByTask.get(task.id) ?? []
    if (dates.length === 0) return { task, current: 0, best: 0 }

    let best = 1
    let run = 1
    for (let i = 1; i < dates.length; i++) {
      run = differenceInCalendarDays(parseISO(dates[i]), parseISO(dates[i - 1])) === 1 ? run + 1 : 1
      best = Math.max(best, run)
    }

    const dateSet = new Set(dates)
    let cursor = dateSet.has(today) ? today : format(subDays(new Date(), 1), 'yyyy-MM-dd')
    let current = 0
    while (dateSet.has(cursor)) {
      current++
      cursor = format(subDays(parseISO(cursor), 1), 'yyyy-MM-dd')
    }

    return { task, current, best }
  })
}

export function Stats() {
  const [loading, setLoading] = useState(true)
  const [dailyPct, setDailyPct] = useState<{ date: string; pct: number }[]>([])
  const [streaks, setStreaks] = useState<Streak[]>([])
  const [categoryBreakdown, setCategoryBreakdown] = useState<{ category: Category | null; pct: number; count: number }[]>([])
  const [pastGoalsByWeek, setPastGoalsByWeek] = useState<{ weekStart: string; goals: WeeklyGoal[] }[]>([])
  const [weightSeries, setWeightSeries] = useState<{ date: string; value: number }[]>([])
  const [goalWeight, setGoalWeight] = useState<number | null>(null)
  const [weightExpanded, setWeightExpanded] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const since = format(subDays(new Date(), 29), 'yyyy-MM-dd')
      const currentWeekStart = weekStartISO()

      const [
        { data: tasks },
        { data: recentCompletions },
        { data: allCompletions },
        { data: categories },
        { data: pastGoals },
        { data: weightEntries },
        { data: settings },
      ] = await Promise.all([
        supabase.from('daily_tasks').select('*').eq('active', true),
        supabase.from('task_completions').select('task_id, date').gte('date', since),
        supabase.from('task_completions').select('task_id, date').order('date').limit(2000),
        supabase.from('categories').select('*'),
        supabase.from('weekly_goals').select('*').lt('week_start', currentWeekStart).order('week_start', { ascending: false }),
        supabase.from('journal_entries').select('date, value_numeric').eq('type', 'weight').order('date').limit(200),
        supabase.from('user_settings').select('*').maybeSingle(),
      ])

      setWeightSeries(
        (weightEntries ?? [])
          .filter((e) => e.value_numeric !== null)
          .map((e) => ({ date: e.date.slice(5), value: e.value_numeric as number })),
      )
      setGoalWeight(settings?.goal_weight != null ? Number(settings.goal_weight) : null)

      const activeTasks = tasks ?? []
      const recent = recentCompletions ?? []
      const all = allCompletions ?? []
      const cats = categories ?? []

      // Completion rate per day over the last 30 days.
      const countByDate = new Map<string, number>()
      for (const c of recent) countByDate.set(c.date, (countByDate.get(c.date) ?? 0) + 1)
      const days: { date: string; pct: number }[] = []
      for (let i = 29; i >= 0; i--) {
        const d = format(subDays(new Date(), i), 'yyyy-MM-dd')
        const pct = activeTasks.length ? Math.round(((countByDate.get(d) ?? 0) / activeTasks.length) * 100) : 0
        days.push({ date: d.slice(5), pct })
      }
      setDailyPct(days)

      // Streaks per active task.
      const completionsByTask = new Map<string, string[]>()
      for (const c of all) {
        const arr = completionsByTask.get(c.task_id) ?? []
        arr.push(c.date)
        completionsByTask.set(c.task_id, arr)
      }
      setStreaks(computeStreaks(activeTasks, completionsByTask).sort((a, b) => b.current - a.current))

      // Category breakdown over the last 30 days.
      const taskById = new Map(activeTasks.map((t) => [t.id, t]))
      const categoryById = new Map(cats.map((c) => [c.id, c]))
      const countByCategory = new Map<string, number>()
      for (const c of recent) {
        const task = taskById.get(c.task_id)
        const key = task?.category_id ?? 'none'
        countByCategory.set(key, (countByCategory.get(key) ?? 0) + 1)
      }
      const total = recent.length || 1
      const breakdown = [...countByCategory.entries()]
        .map(([key, count]) => ({
          category: key === 'none' ? null : (categoryById.get(key) ?? null),
          count,
          pct: Math.round((count / total) * 100),
        }))
        .sort((a, b) => b.count - a.count)
      setCategoryBreakdown(breakdown)

      // Goals history, grouped by week.
      const byWeek = new Map<string, WeeklyGoal[]>()
      for (const g of pastGoals ?? []) {
        const arr = byWeek.get(g.week_start) ?? []
        arr.push(g)
        byWeek.set(g.week_start, arr)
      }
      setPastGoalsByWeek([...byWeek.entries()].map(([weekStart, goals]) => ({ weekStart, goals })).slice(0, 12))

      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col gap-4 px-4 pt-6 pb-2">
        <h1 className="text-2xl font-bold text-gray-900">Statistics</h1>
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-6 pb-4">
      <h1 className="text-2xl font-bold text-gray-900">Statistics</h1>

      {weightSeries.length > 1 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-500">Weight — tap to expand</h2>
          <button
            onClick={() => setWeightExpanded(true)}
            className="block w-full rounded-3xl border border-gray-100 bg-white p-2 text-left shadow-sm"
          >
            <WeightChart data={weightSeries} goalWeight={goalWeight} height={192} />
          </button>
        </div>
      )}

      {weightExpanded && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-gray-900">Weight</h2>
            <button onClick={() => setWeightExpanded(false)} className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600">
              Close ✕
            </button>
          </div>
          <div className="flex-1 px-2 pb-4">
            <WeightChart data={weightSeries} goalWeight={goalWeight} height={window.innerHeight - 120} />
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-500">Completion rate — last 30 days</h2>
        <div className="h-40 rounded-3xl border border-gray-100 bg-white p-2 shadow-sm">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyPct}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f0f7" />
              <XAxis dataKey="date" stroke="#9ca3af" fontSize={9} interval={4} />
              <YAxis stroke="#9ca3af" fontSize={10} domain={[0, 100]} />
              <Tooltip contentStyle={{ background: '#fff', border: '1px solid #f1f0f7', fontSize: 12, borderRadius: 12 }} />
              <Bar dataKey="pct" fill="#7c3aed" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-500">Streaks</h2>
        {streaks.length === 0 ? (
          <p className="text-sm text-gray-400">No tasks yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {streaks.map(({ task, current, best }) => (
              <li key={task.id} className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                <span className="font-medium text-gray-900">{task.title}</span>
                <span className="text-sm text-gray-500">
                  🔥 {current} current · best {best}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-500">Where your effort goes</h2>
        {categoryBreakdown.length === 0 ? (
          <p className="text-sm text-gray-400">No completions in the last 30 days.</p>
        ) : (
          <div className="flex flex-col gap-2 rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
            {categoryBreakdown.map(({ category, pct }) => {
              const style = category ? CATEGORY_STYLES[category.color] : { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-400' }
              return (
                <div key={category?.id ?? 'none'} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-sm font-medium text-gray-700">{category?.name ?? 'No label'}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div className={`h-full rounded-full ${style.dot}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={`w-10 shrink-0 text-right text-sm font-medium ${style.text}`}>{pct}%</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-500">Goals history</h2>
        {pastGoalsByWeek.length === 0 ? (
          <p className="text-sm text-gray-400">No past weeks yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pastGoalsByWeek.map(({ weekStart, goals }) => (
              <li key={weekStart} className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
                <p className="mb-2 text-xs font-semibold text-gray-400">Week of {weekStart}</p>
                <ul className="flex flex-col gap-1.5">
                  {goals.map((g) => (
                    <li key={g.id} className="flex items-center justify-between text-sm">
                      <span className="text-gray-900">{g.title}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          g.status === 'done' ? 'bg-emerald-100 text-emerald-600' : 'bg-pink-100 text-pink-600'
                        }`}
                      >
                        {g.target_value ? `${g.progress}/${g.target_value}` : g.status === 'done' ? 'Done' : 'Active'}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
