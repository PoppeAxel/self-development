import { useEffect, useState } from 'react'
import { LineChart, Line, BarChart, Bar, ReferenceLine, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { parseISO } from 'date-fns'
import { supabase } from '../lib/supabase'
import { todayISO, weekStartISO } from '../lib/dates'
import { RefreshButton } from '../components/RefreshButton'
import { RECOMMENDED_SLEEP_HOURS, formatSleepDuration } from '../lib/sleep'
import { formatWorkoutDuration, formatWorkoutDistance, isStrengthWorkout } from '../lib/workouts'
import type { JournalEntry, JournalEntryType, Workout } from '../lib/types'

// steps/cardio/strength have no manual-entry form (synced from Garmin/Strava) but still
// get a read-only tab for their chart. 'cardio'/'strength' aren't JournalEntryTypes — they
// come from the workouts table, split by sport_type — so the tab union extends past that
// type. cardio_minutes/strength_minutes (the derived daily totals journal_entries stores
// purely for auto_metric matching, see src/lib/metrics.ts) are excluded here since Cardio/
// Strength already cover that data with richer detail. Mood/Notes are dropped for now —
// not deleted, just off the tab bar.
type JournalTab = Exclude<JournalEntryType, 'cardio_minutes' | 'strength_minutes' | 'mood' | 'note'> | 'cardio' | 'strength'
const TABS: JournalTab[] = ['weight', 'sleep_hours', 'steps', 'cardio', 'strength']
const TAB_LABELS: Record<JournalTab, string> = {
  weight: 'Weight',
  sleep_hours: 'Sleep',
  steps: 'Steps',
  cardio: 'Cardio',
  strength: 'Strength',
}

interface WeeklySleep {
  weekStart: string
  avg: number
  min: number
  max: number
  nights: number
}

function WeightChart({ data, goalWeight, height }: { data: { date: string; value: number }[]; goalWeight: number | null; height: number }) {
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
        <Line type="monotone" dataKey="value" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 3, fill: '#7c3aed' }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function StepsChart({ data, stepGoal, height }: { data: { date: string; value: number }[]; stepGoal: number | null; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f0f7" />
        <XAxis dataKey="date" stroke="#9ca3af" fontSize={11} />
        <YAxis stroke="#9ca3af" fontSize={11} />
        <Tooltip contentStyle={{ background: '#fff', border: '1px solid #f1f0f7', fontSize: 12, borderRadius: 12 }} />
        {stepGoal != null && (
          <ReferenceLine
            y={stepGoal}
            stroke="#0284c7"
            strokeWidth={2}
            strokeDasharray="6 4"
            ifOverflow="extendDomain"
            label={{ value: `Goal ${stepGoal.toLocaleString()}`, fontSize: 12, fontWeight: 600, fill: '#0284c7', position: 'insideTopLeft' }}
          />
        )}
        <Bar dataKey="value" fill="#38bdf8" radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function WorkoutsChart({ data, color, height }: { data: { date: string; minutes: number }[]; color: string; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f0f7" />
        <XAxis dataKey="date" stroke="#9ca3af" fontSize={11} />
        <YAxis stroke="#9ca3af" fontSize={11} />
        <Tooltip
          contentStyle={{ background: '#fff', border: '1px solid #f1f0f7', fontSize: 12, borderRadius: 12 }}
          formatter={(value) => [`${value} min`, 'Trained']}
        />
        <Bar dataKey="minutes" fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function weeklyMinutes(workouts: Workout[]): { date: string; minutes: number }[] {
  const byWeek = new Map<string, number>()
  for (const w of workouts) {
    const wk = weekStartISO(parseISO(w.date))
    byWeek.set(wk, (byWeek.get(wk) ?? 0) + Math.round(w.duration_seconds / 60))
  }
  return [...byWeek.entries()]
    .map(([weekStart, minutes]) => ({ date: weekStart.slice(5), minutes }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-12)
}

export function Journal() {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<JournalTab>('weight')
  const [weight, setWeight] = useState('')
  const [sleepHoursPart, setSleepHoursPart] = useState('')
  const [sleepMinutesPart, setSleepMinutesPart] = useState('')
  const [goalWeight, setGoalWeight] = useState<number | null>(null)
  const [stepGoal, setStepGoal] = useState<number | null>(null)
  const [weightExpanded, setWeightExpanded] = useState(false)
  const [stepsExpanded, setStepsExpanded] = useState(false)
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [cardioExpanded, setCardioExpanded] = useState(false)
  const [strengthExpanded, setStrengthExpanded] = useState(false)

  async function load() {
    setLoading(true)
    const [{ data }, { data: settingsRow }, { data: workoutRows }] = await Promise.all([
      supabase.from('journal_entries').select('*').order('date', { ascending: true }).limit(200),
      supabase.from('user_settings').select('*').maybeSingle(),
      supabase.from('workouts').select('*').order('date', { ascending: true }).limit(200),
    ])
    setEntries(data ?? [])
    setGoalWeight(settingsRow?.goal_weight != null ? Number(settingsRow.goal_weight) : null)
    setStepGoal(settingsRow?.step_goal != null ? Number(settingsRow.step_goal) : null)
    setWorkouts(workoutRows ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function addEntry(type: JournalEntryType, valueNumeric: number | null, valueText: string | null) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    // sleep_hours is a once-per-day value (like the auto-synced metrics), not a
    // free-running log like weight — update today's entry if it exists.
    if (type === 'sleep_hours') {
      const { data: existing } = await supabase
        .from('journal_entries')
        .select('id')
        .eq('type', 'sleep_hours')
        .eq('date', todayISO())
        .maybeSingle()
      if (existing) {
        await supabase.from('journal_entries').update({ value_numeric: valueNumeric }).eq('id', existing.id)
        load()
        return
      }
    }

    await supabase.from('journal_entries').insert({
      type,
      value_numeric: valueNumeric,
      value_text: valueText,
      date: todayISO(),
      user_id: user.id,
    })
    load()
  }

  async function remove(entry: JournalEntry) {
    setEntries((es) => es.filter((e) => e.id !== entry.id))
    await supabase.from('journal_entries').delete().eq('id', entry.id)
  }

  async function removeWorkout(workout: Workout) {
    setWorkouts((ws) => ws.filter((w) => w.id !== workout.id))
    await supabase.from('workouts').delete().eq('id', workout.id)
  }

  const weightSeries = entries
    .filter((e) => e.type === 'weight' && e.value_numeric !== null)
    .map((e) => ({ date: e.date.slice(5), value: e.value_numeric as number }))

  const sleepSeries = entries
    .filter((e) => e.type === 'sleep_hours' && e.value_numeric !== null)
    .slice(-14)
    .map((e) => ({ date: e.date.slice(5), value: e.value_numeric as number }))

  const stepsSeries = entries
    .filter((e) => e.type === 'steps' && e.value_numeric !== null)
    .slice(-30)
    .map((e) => ({ date: e.date.slice(5), value: e.value_numeric as number }))

  const recent = entries
    .filter((e) => e.type === tab)
    .slice(-20)
    .reverse()

  // Force whole-hour Y-axis ticks — recharts' auto ticks land on awkward
  // fractional-hour values otherwise, which reads as misleading for a duration.
  const sleepYMax = Math.ceil(Math.max(RECOMMENDED_SLEEP_HOURS, ...sleepSeries.map((s) => s.value))) + 1

  // Sleep grouped into Mon–Sun weeks.
  const sleepByWeek = new Map<string, number[]>()
  for (const e of entries) {
    if (e.type !== 'sleep_hours' || e.value_numeric == null) continue
    const wk = weekStartISO(parseISO(e.date))
    const arr = sleepByWeek.get(wk) ?? []
    arr.push(e.value_numeric)
    sleepByWeek.set(wk, arr)
  }
  const weeklySleep: WeeklySleep[] = [...sleepByWeek.entries()]
    .map(([weekStart, values]) => ({
      weekStart,
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      nights: values.length,
    }))
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
    .slice(0, 12)

  const cardioWorkouts = workouts.filter((w) => !isStrengthWorkout(w.sport_type))
  const strengthWorkouts = workouts.filter((w) => isStrengthWorkout(w.sport_type))
  const weeklyCardioMinutes = weeklyMinutes(cardioWorkouts)
  const weeklyStrengthMinutes = weeklyMinutes(strengthWorkouts)
  const recentCardioWorkouts = [...cardioWorkouts].reverse().slice(0, 20)
  const recentStrengthWorkouts = [...strengthWorkouts].reverse().slice(0, 20)

  return (
    <div className="flex flex-col gap-4 px-4 pt-6 pb-2">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Your Journal</h1>
        <RefreshButton onRefresh={load} />
      </div>

      <div className="flex gap-2 rounded-2xl bg-gray-100 p-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-xl px-2 py-2 text-sm font-medium transition ${
              tab === t ? 'bg-white text-violet-600 shadow-sm' : 'text-gray-500'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'weight' && (
        <div className="flex gap-2">
          <input
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            type="number"
            step="0.1"
            placeholder="Weight (kg)"
            className="flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-violet-400"
          />
          <button
            onClick={() => {
              if (!weight) return
              addEntry('weight', Number(weight), null)
              setWeight('')
            }}
            className="rounded-2xl bg-violet-600 px-4 py-2.5 font-semibold text-white"
          >
            Log
          </button>
        </div>
      )}

      {tab === 'sleep_hours' && (
        <div className="flex gap-2">
          <input
            value={sleepHoursPart}
            onChange={(e) => setSleepHoursPart(e.target.value)}
            type="number"
            step="1"
            placeholder="Hours"
            className="min-w-0 flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-violet-400"
          />
          <input
            value={sleepMinutesPart}
            onChange={(e) => setSleepMinutesPart(e.target.value)}
            type="number"
            step="1"
            placeholder="Minutes"
            className="min-w-0 flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-violet-400"
          />
          <button
            onClick={() => {
              if (!sleepHoursPart && !sleepMinutesPart) return
              const value = (Number(sleepHoursPart) || 0) + (Number(sleepMinutesPart) || 0) / 60
              addEntry('sleep_hours', Math.round(value * 10000) / 10000, null)
              setSleepHoursPart('')
              setSleepMinutesPart('')
            }}
            className="shrink-0 rounded-2xl bg-violet-600 px-4 py-2.5 font-semibold text-white"
          >
            Log
          </button>
        </div>
      )}

      {tab === 'steps' && <p className="text-sm text-gray-400">Synced automatically from Garmin — nothing to log here.</p>}

      {(tab === 'cardio' || tab === 'strength') && (
        <p className="text-sm text-gray-400">Synced automatically from Strava — nothing to log here.</p>
      )}

      {tab === 'weight' && weightSeries.length > 1 && (
        <button
          onClick={() => setWeightExpanded(true)}
          className="block w-full rounded-3xl border border-gray-100 bg-white p-2 text-left shadow-sm"
        >
          <WeightChart data={weightSeries} goalWeight={goalWeight} height={192} />
        </button>
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

      {tab === 'sleep_hours' && sleepSeries.length > 0 && (
        <div className="h-48 rounded-3xl border border-gray-100 bg-white p-2 shadow-sm">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sleepSeries} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f0f7" />
              <XAxis dataKey="date" stroke="#9ca3af" fontSize={11} />
              <YAxis stroke="#9ca3af" fontSize={11} domain={[0, sleepYMax]} tickCount={sleepYMax + 1} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #f1f0f7', fontSize: 12, borderRadius: 12 }}
                formatter={(value) => [formatSleepDuration(Number(value)), 'Slept']}
              />
              <ReferenceLine
                y={RECOMMENDED_SLEEP_HOURS}
                stroke="#059669"
                strokeWidth={2}
                strokeDasharray="6 4"
                ifOverflow="extendDomain"
                label={{ value: `${RECOMMENDED_SLEEP_HOURS}h recommended`, fontSize: 12, fontWeight: 600, fill: '#059669', position: 'insideTopLeft' }}
              />
              <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {tab === 'sleep_hours' && weeklySleep.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-500">Weekly average</h2>
          <ul className="flex flex-col gap-2">
            {weeklySleep.map((week) => {
              const metGoal = week.avg >= RECOMMENDED_SLEEP_HOURS
              return (
                <li key={week.weekStart} className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Week of {week.weekStart}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        metGoal ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                      }`}
                    >
                      {formatSleepDuration(week.avg)} avg
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-400">
                    {formatSleepDuration(week.min)} – {formatSleepDuration(week.max)} · {week.nights} night{week.nights === 1 ? '' : 's'}{' '}
                    logged
                  </p>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {tab === 'steps' && stepsSeries.length > 1 && (
        <button
          onClick={() => setStepsExpanded(true)}
          className="block w-full rounded-3xl border border-gray-100 bg-white p-2 text-left shadow-sm"
        >
          <StepsChart data={stepsSeries} stepGoal={stepGoal} height={192} />
        </button>
      )}

      {stepsExpanded && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-gray-900">Steps</h2>
            <button onClick={() => setStepsExpanded(false)} className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600">
              Close ✕
            </button>
          </div>
          <div className="flex-1 px-2 pb-4">
            <StepsChart data={stepsSeries} stepGoal={stepGoal} height={window.innerHeight - 120} />
          </div>
        </div>
      )}

      {tab === 'cardio' && weeklyCardioMinutes.length > 1 && (
        <button
          onClick={() => setCardioExpanded(true)}
          className="block w-full rounded-3xl border border-gray-100 bg-white p-2 text-left shadow-sm"
        >
          <WorkoutsChart data={weeklyCardioMinutes} color="#f97316" height={192} />
        </button>
      )}

      {cardioExpanded && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-gray-900">Cardio</h2>
            <button onClick={() => setCardioExpanded(false)} className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600">
              Close ✕
            </button>
          </div>
          <div className="flex-1 px-2 pb-4">
            <WorkoutsChart data={weeklyCardioMinutes} color="#f97316" height={window.innerHeight - 120} />
          </div>
        </div>
      )}

      {tab === 'strength' && weeklyStrengthMinutes.length > 1 && (
        <button
          onClick={() => setStrengthExpanded(true)}
          className="block w-full rounded-3xl border border-gray-100 bg-white p-2 text-left shadow-sm"
        >
          <WorkoutsChart data={weeklyStrengthMinutes} color="#e11d48" height={192} />
        </button>
      )}

      {strengthExpanded && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-gray-900">Strength</h2>
            <button
              onClick={() => setStrengthExpanded(false)}
              className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600"
            >
              Close ✕
            </button>
          </div>
          <div className="flex-1 px-2 pb-4">
            <WorkoutsChart data={weeklyStrengthMinutes} color="#e11d48" height={window.innerHeight - 120} />
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : tab === 'cardio' || tab === 'strength' ? (
        <>
          <h2 className="text-sm font-semibold text-gray-500">Recent {TAB_LABELS[tab]}</h2>
          {(() => {
            const list = tab === 'cardio' ? recentCardioWorkouts : recentStrengthWorkouts
            const badgeStyle = tab === 'cardio' ? 'bg-orange-100 text-orange-600' : 'bg-rose-100 text-rose-600'
            return (
              <>
                {list.length === 0 && <p className="text-sm text-gray-400">Nothing synced yet.</p>}
                <ul className="flex flex-col gap-2 pb-4">
                  {list.map((workout) => {
                    const distance = formatWorkoutDistance(workout.distance_meters)
                    return (
                      <li
                        key={workout.id}
                        className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white px-4 py-3 text-sm shadow-sm"
                      >
                        <span className="text-gray-400">{workout.date}</span>
                        <span className="flex-1 px-3">
                          <span className="font-medium text-gray-900">{workout.name}</span>
                          <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${badgeStyle}`}>{workout.sport_type}</span>
                          <span className="block text-[11px] text-gray-400">
                            {formatWorkoutDuration(workout.duration_seconds)}
                            {distance && ` · ${distance}`}
                            {workout.calories != null && ` · ${workout.calories} cal`}
                          </span>
                        </span>
                        <button onClick={() => removeWorkout(workout)} className="text-gray-300">
                          ✕
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )
          })()}
        </>
      ) : (
        <>
          <h2 className="text-sm font-semibold text-gray-500">Recent {TAB_LABELS[tab]}</h2>
          {recent.length === 0 && <p className="text-sm text-gray-400">Nothing logged yet.</p>}
          <ul className="flex flex-col gap-2 pb-4">
            {recent.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white px-4 py-3 text-sm shadow-sm"
              >
                <span className="text-gray-400">{entry.date}</span>
                <span className="flex-1 px-3 font-medium text-gray-900">
                  {entry.type === 'weight' && `${entry.value_numeric} kg`}
                  {entry.type === 'sleep_hours' && entry.value_numeric != null && `${formatSleepDuration(entry.value_numeric)} slept`}
                  {entry.type === 'steps' && entry.value_numeric != null && `${entry.value_numeric.toLocaleString()} steps`}
                </span>
                <button onClick={() => remove(entry)} className="text-gray-300">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
