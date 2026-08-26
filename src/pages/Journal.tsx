import { useEffect, useState } from 'react'
import { LineChart, Line, BarChart, Bar, ReferenceLine, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { parseISO } from 'date-fns'
import { supabase } from '../lib/supabase'
import { todayISO, weekStartISO } from '../lib/dates'
import { RefreshButton } from '../components/RefreshButton'
import { GymPrograms } from '../components/GymPrograms'
import { FoodTracking } from '../components/FoodTracking'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { RECOMMENDED_SLEEP_HOURS, formatSleepDuration } from '../lib/sleep'
import { formatWorkoutDuration, formatWorkoutDistance, isStrengthWorkout, getSportStyle } from '../lib/workouts'
import type { JournalEntry, JournalEntryType, Workout } from '../lib/types'

// steps/cardio/strength have no manual-entry form (synced from Garmin/Strava) but still
// get a read-only tab for their chart. 'cardio'/'strength' aren't JournalEntryTypes — they
// come from the workouts table, split by sport_type — so the tab union extends past that
// type. cardio_minutes/strength_minutes (the derived daily totals journal_entries stores
// purely for auto_metric matching, see src/lib/metrics.ts) are excluded here since Cardio/
// Strength already cover that data with richer detail. Mood/Notes are dropped for now —
// not deleted, just off the tab bar. 'food' is its own tables (ingredients/recipes/
// food_log_entries), not a JournalEntryType — see FoodTracking.tsx, which renders its own
// log/chart/recipe UI entirely (this file just mounts it, no generic entry list applies).
type JournalTab = Exclude<JournalEntryType, 'cardio_minutes' | 'strength_minutes' | 'mood' | 'note'> | 'cardio' | 'strength' | 'food'
const TABS: JournalTab[] = ['weight', 'sleep_hours', 'steps', 'cardio', 'strength', 'food']
const TAB_LABELS: Record<JournalTab, string> = {
  weight: 'Weight',
  sleep_hours: 'Sleep',
  steps: 'Steps',
  cardio: 'Cardio',
  strength: 'Strength',
  food: 'Food',
}
const ENTRY_TYPE_LABELS: Partial<Record<JournalEntryType, string>> = {
  weight: 'weight entry',
  sleep_hours: 'sleep entry',
  steps: 'steps entry',
}

interface WeeklySleep {
  weekStart: string
  avg: number
  min: number
  max: number
  nights: number
}

interface WeeklyWeight {
  weekStart: string
  avg: number
  min: number
  max: number
  entries: number
}

interface WeeklySteps {
  weekStart: string
  avg: number
  min: number
  max: number
  days: number
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

function WorkoutsChart({
  data,
  color,
  height,
  unit,
  decimals = 0,
}: {
  data: { date: string; value: number }[]
  color: string
  height: number
  unit: string
  decimals?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f0f7" />
        <XAxis dataKey="date" stroke="#9ca3af" fontSize={11} />
        <YAxis stroke="#9ca3af" fontSize={11} />
        <Tooltip
          contentStyle={{ background: '#fff', border: '1px solid #f1f0f7', fontSize: 12, borderRadius: 12 }}
          formatter={(value) => [`${Number(value).toFixed(decimals)} ${unit}`, 'Trained']}
        />
        <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

interface WeeklyMinutes {
  weekStart: string
  date: string
  value: number
}

function weeklyMinutes(workouts: Workout[]): WeeklyMinutes[] {
  const byWeek = new Map<string, number>()
  for (const w of workouts) {
    const wk = weekStartISO(parseISO(w.date))
    byWeek.set(wk, (byWeek.get(wk) ?? 0) + Math.round(w.duration_seconds / 60))
  }
  return [...byWeek.entries()]
    .map(([weekStart, value]) => ({ weekStart, date: weekStart.slice(5), value }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .slice(-12)
}

interface WeeklyCardioWeek {
  weekStart: string
  total: number
  bySport: Record<string, number>
}

interface ChartRow {
  date: string
  [sportType: string]: number | string
}

interface WeeklyDistanceBySport {
  chartData: ChartRow[]
  sportTypes: string[]
  weeks: WeeklyCardioWeek[] // ascending, same 12-week window as chartData
}

// Weekly km, broken down per Strava sport_type, for the stacked Cardio chart and stats.
function weeklyDistanceBySport(workouts: Workout[]): WeeklyDistanceBySport {
  const byWeek = new Map<string, Record<string, number>>()
  const sportTypes = new Set<string>()
  for (const w of workouts) {
    const wk = weekStartISO(parseISO(w.date))
    const bucket = byWeek.get(wk) ?? {}
    bucket[w.sport_type] = (bucket[w.sport_type] ?? 0) + (w.distance_meters ?? 0) / 1000
    byWeek.set(wk, bucket)
    sportTypes.add(w.sport_type)
  }
  const weekStarts = [...byWeek.keys()].sort().slice(-12)
  const weeks: WeeklyCardioWeek[] = weekStarts.map((weekStart) => {
    const bySport = byWeek.get(weekStart)!
    const total = Object.values(bySport).reduce((a, b) => a + b, 0)
    return { weekStart, total, bySport }
  })
  const chartData: ChartRow[] = weeks.map(({ weekStart, bySport }) => {
    const row: ChartRow = { date: weekStart.slice(5) }
    for (const [sportType, km] of Object.entries(bySport)) row[sportType] = km
    return row
  })
  return { chartData, sportTypes: [...sportTypes].sort(), weeks }
}

function CardioChart({ data, sportTypes, height }: { data: WeeklyDistanceBySport['chartData']; sportTypes: string[]; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f0f7" />
        <XAxis dataKey="date" stroke="#9ca3af" fontSize={11} />
        <YAxis stroke="#9ca3af" fontSize={11} />
        <Tooltip
          contentStyle={{ background: '#fff', border: '1px solid #f1f0f7', fontSize: 12, borderRadius: 12 }}
          formatter={(value, name) => [`${Number(value).toFixed(1)} km`, getSportStyle(String(name)).label]}
        />
        {sportTypes.map((sportType, i) => (
          <Bar
            key={sportType}
            dataKey={sportType}
            stackId="cardio"
            fill={getSportStyle(sportType).color}
            radius={i === sportTypes.length - 1 ? [4, 4, 0, 0] : undefined}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
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
  const [showHistory, setShowHistory] = useState(false)
  const [trainingTimeOpen, setTrainingTimeOpen] = useState(false)
  const [confirmDeleteEntry, setConfirmDeleteEntry] = useState<JournalEntry | null>(null)
  const [confirmDeleteWorkout, setConfirmDeleteWorkout] = useState<Workout | null>(null)

  useEffect(() => {
    setShowHistory(false)
  }, [tab])

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
  const weeklySleepAsc: WeeklySleep[] = [...sleepByWeek.entries()]
    .map(([weekStart, values]) => ({
      weekStart,
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      nights: values.length,
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
  const weeklySleep = [...weeklySleepAsc].reverse().slice(0, 12)

  const currentSleepWeek = weeklySleepAsc[weeklySleepAsc.length - 1] ?? null
  const previousSleepWeek = weeklySleepAsc[weeklySleepAsc.length - 2] ?? null
  const weekSleepChange = currentSleepWeek && previousSleepWeek ? currentSleepWeek.avg - previousSleepWeek.avg : null

  // Trend: average week-over-week change across the last few completed weeks.
  const recentSleepWeeks = weeklySleepAsc.slice(-5)
  const sleepDiffs: number[] = []
  for (let i = 1; i < recentSleepWeeks.length; i++) {
    sleepDiffs.push(recentSleepWeeks[i].avg - recentSleepWeeks[i - 1].avg)
  }
  const sleepTrendPerWeek = sleepDiffs.length > 0 ? sleepDiffs.reduce((a, b) => a + b, 0) / sleepDiffs.length : null

  // Weight grouped into Mon–Sun weeks, ascending for trend math.
  const weightByWeek = new Map<string, number[]>()
  for (const e of entries) {
    if (e.type !== 'weight' || e.value_numeric == null) continue
    const wk = weekStartISO(parseISO(e.date))
    const arr = weightByWeek.get(wk) ?? []
    arr.push(e.value_numeric)
    weightByWeek.set(wk, arr)
  }
  const weeklyWeightAsc: WeeklyWeight[] = [...weightByWeek.entries()]
    .map(([weekStart, values]) => ({
      weekStart,
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      entries: values.length,
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
  const weeklyWeight = [...weeklyWeightAsc].reverse().slice(0, 12)

  const currentWeightWeek = weeklyWeightAsc[weeklyWeightAsc.length - 1] ?? null
  const previousWeightWeek = weeklyWeightAsc[weeklyWeightAsc.length - 2] ?? null
  const weekWeightChange =
    currentWeightWeek && previousWeightWeek ? currentWeightWeek.avg - previousWeightWeek.avg : null

  // Trend: average week-over-week change across the last few completed weeks.
  const recentWeightWeeks = weeklyWeightAsc.slice(-5)
  const weightDiffs: number[] = []
  for (let i = 1; i < recentWeightWeeks.length; i++) {
    weightDiffs.push(recentWeightWeeks[i].avg - recentWeightWeeks[i - 1].avg)
  }
  const weightTrendPerWeek = weightDiffs.length > 0 ? weightDiffs.reduce((a, b) => a + b, 0) / weightDiffs.length : null

  const weightEntries = entries.filter((e) => e.type === 'weight' && e.value_numeric !== null)
  const firstWeightEntry = weightEntries[0] ?? null
  const latestWeightEntry = weightEntries[weightEntries.length - 1] ?? null
  const totalWeightChange =
    firstWeightEntry && latestWeightEntry && firstWeightEntry !== latestWeightEntry
      ? (latestWeightEntry.value_numeric as number) - (firstWeightEntry.value_numeric as number)
      : null

  // Positive = still need to lose weight to hit the goal, negative = need to gain.
  const distanceToGoal =
    latestWeightEntry && goalWeight != null ? (latestWeightEntry.value_numeric as number) - goalWeight : null

  // Only estimate an ETA if the current trend is actually moving toward the goal.
  let weeksToGoal: number | null = null
  if (distanceToGoal != null && Math.abs(distanceToGoal) > 0.05 && weightTrendPerWeek != null && weightTrendPerWeek !== 0) {
    const movingTowardGoal = (distanceToGoal > 0 && weightTrendPerWeek < 0) || (distanceToGoal < 0 && weightTrendPerWeek > 0)
    if (movingTowardGoal) weeksToGoal = Math.abs(distanceToGoal / weightTrendPerWeek)
  }

  // Steps grouped into Mon–Sun weeks, ascending for trend math.
  const stepsByWeek = new Map<string, number[]>()
  for (const e of entries) {
    if (e.type !== 'steps' || e.value_numeric == null) continue
    const wk = weekStartISO(parseISO(e.date))
    const arr = stepsByWeek.get(wk) ?? []
    arr.push(e.value_numeric)
    stepsByWeek.set(wk, arr)
  }
  const weeklyStepsAsc: WeeklySteps[] = [...stepsByWeek.entries()]
    .map(([weekStart, values]) => ({
      weekStart,
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      days: values.length,
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
  const weeklySteps = [...weeklyStepsAsc].reverse().slice(0, 12)

  const currentStepsWeek = weeklyStepsAsc[weeklyStepsAsc.length - 1] ?? null
  const previousStepsWeek = weeklyStepsAsc[weeklyStepsAsc.length - 2] ?? null
  const weekStepsChange = currentStepsWeek && previousStepsWeek ? currentStepsWeek.avg - previousStepsWeek.avg : null

  // Trend: average week-over-week change across the last few completed weeks.
  const recentStepsWeeks = weeklyStepsAsc.slice(-5)
  const stepsDiffs: number[] = []
  for (let i = 1; i < recentStepsWeeks.length; i++) {
    stepsDiffs.push(recentStepsWeeks[i].avg - recentStepsWeeks[i - 1].avg)
  }
  const stepsTrendPerWeek = stepsDiffs.length > 0 ? stepsDiffs.reduce((a, b) => a + b, 0) / stepsDiffs.length : null

  const cardioWorkouts = workouts.filter((w) => !isStrengthWorkout(w.sport_type))
  const strengthWorkouts = workouts.filter((w) => isStrengthWorkout(w.sport_type))
  const weeklyCardioDistance = weeklyDistanceBySport(cardioWorkouts)
  const weeklyStrengthMinutes = weeklyMinutes(strengthWorkouts)
  const recentCardioWorkouts = [...cardioWorkouts].reverse().slice(0, 20)
  const recentStrengthWorkouts = [...strengthWorkouts].reverse().slice(0, 20)

  const currentCardioWeek = weeklyCardioDistance.weeks[weeklyCardioDistance.weeks.length - 1] ?? null
  const previousCardioWeek = weeklyCardioDistance.weeks[weeklyCardioDistance.weeks.length - 2] ?? null
  const weekCardioChange = currentCardioWeek && previousCardioWeek ? currentCardioWeek.total - previousCardioWeek.total : null
  const recentCardioWeeksForTrend = weeklyCardioDistance.weeks.slice(-5)
  const cardioDiffs: number[] = []
  for (let i = 1; i < recentCardioWeeksForTrend.length; i++) {
    cardioDiffs.push(recentCardioWeeksForTrend[i].total - recentCardioWeeksForTrend[i - 1].total)
  }
  const cardioTrendPerWeek = cardioDiffs.length > 0 ? cardioDiffs.reduce((a, b) => a + b, 0) / cardioDiffs.length : null
  const cardioWeeksDesc = [...weeklyCardioDistance.weeks].reverse()

  const currentStrengthWeek = weeklyStrengthMinutes[weeklyStrengthMinutes.length - 1] ?? null
  const previousStrengthWeek = weeklyStrengthMinutes[weeklyStrengthMinutes.length - 2] ?? null
  const weekStrengthChange = currentStrengthWeek && previousStrengthWeek ? currentStrengthWeek.value - previousStrengthWeek.value : null
  const recentStrengthWeeksForTrend = weeklyStrengthMinutes.slice(-5)
  const strengthDiffs: number[] = []
  for (let i = 1; i < recentStrengthWeeksForTrend.length; i++) {
    strengthDiffs.push(recentStrengthWeeksForTrend[i].value - recentStrengthWeeksForTrend[i - 1].value)
  }
  const strengthTrendPerWeek = strengthDiffs.length > 0 ? strengthDiffs.reduce((a, b) => a + b, 0) / strengthDiffs.length : null
  const strengthWeeksDesc = [...weeklyStrengthMinutes].reverse()

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

      {tab === 'cardio' && <p className="text-sm text-gray-400">Synced automatically from Strava — nothing to log here.</p>}

      {tab === 'strength' && (
        <>
          <GymPrograms strengthWorkouts={strengthWorkouts} />
          <p className="text-sm text-gray-400">Total strength time below is synced automatically from Strava.</p>
        </>
      )}

      {tab === 'food' && <FoodTracking />}

      {tab === 'weight' && firstWeightEntry && latestWeightEntry && (
        <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Start · {firstWeightEntry.date}</span>
            <span>Now · {latestWeightEntry.date}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-lg font-bold text-gray-900">{(firstWeightEntry.value_numeric as number).toFixed(1)} kg</span>
            <span className="text-gray-300">→</span>
            <span className="text-lg font-bold text-gray-900">{(latestWeightEntry.value_numeric as number).toFixed(1)} kg</span>
          </div>
          {totalWeightChange !== null && (
            <p
              className={`mt-1 text-sm font-semibold ${
                totalWeightChange > 0 ? 'text-red-500' : totalWeightChange < 0 ? 'text-emerald-500' : 'text-gray-400'
              }`}
            >
              {totalWeightChange > 0 ? '+' : ''}
              {totalWeightChange.toFixed(1)} kg overall
            </p>
          )}
          {goalWeight != null && distanceToGoal !== null && (
            <div className="mt-2 border-t border-gray-100 pt-2 text-sm text-gray-500">
              {Math.abs(distanceToGoal) <= 0.05 ? (
                <span className="font-semibold text-emerald-500">Goal reached 🎉</span>
              ) : (
                <>
                  <span className="font-medium text-gray-900">{Math.abs(distanceToGoal).toFixed(1)} kg</span> to{' '}
                  {distanceToGoal > 0 ? 'lose' : 'gain'} to reach {goalWeight} kg
                  <span className="block text-xs text-gray-400">
                    {weeksToGoal !== null
                      ? `~${Math.ceil(weeksToGoal)} week${Math.ceil(weeksToGoal) === 1 ? '' : 's'} at current trend`
                      : "Current trend isn't moving toward your goal"}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'weight' && weekWeightChange !== null && currentWeightWeek && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-gray-400">This week</p>
            <p className="text-lg font-bold text-gray-900">{currentWeightWeek.avg.toFixed(1)} kg</p>
            <p
              className={`text-sm font-semibold ${
                weekWeightChange > 0 ? 'text-red-500' : weekWeightChange < 0 ? 'text-emerald-500' : 'text-gray-400'
              }`}
            >
              {weekWeightChange > 0 ? '+' : ''}
              {weekWeightChange.toFixed(1)} kg vs last week
            </p>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-gray-400">Trend</p>
            <p
              className={`text-lg font-bold ${
                weightTrendPerWeek == null || weightTrendPerWeek === 0
                  ? 'text-gray-900'
                  : weightTrendPerWeek > 0
                    ? 'text-red-500'
                    : 'text-emerald-500'
              }`}
            >
              {weightTrendPerWeek == null ? '—' : (
                <>
                  {weightTrendPerWeek > 0 ? '↗' : weightTrendPerWeek < 0 ? '↘' : '→'} {Math.abs(weightTrendPerWeek).toFixed(2)} kg/wk
                </>
              )}
            </p>
          </div>
        </div>
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

      {tab === 'sleep_hours' && weekSleepChange !== null && currentSleepWeek && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-gray-400">This week</p>
            <p className="text-lg font-bold text-gray-900">{formatSleepDuration(currentSleepWeek.avg)}</p>
            <p
              className={`text-sm font-semibold ${
                weekSleepChange > 0 ? 'text-emerald-500' : weekSleepChange < 0 ? 'text-red-500' : 'text-gray-400'
              }`}
            >
              {weekSleepChange > 0 ? '+' : ''}
              {formatSleepDuration(Math.abs(weekSleepChange))} {weekSleepChange >= 0 ? 'more' : 'less'} vs last week
            </p>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-gray-400">Trend</p>
            <p
              className={`text-lg font-bold ${
                sleepTrendPerWeek == null || sleepTrendPerWeek === 0
                  ? 'text-gray-900'
                  : sleepTrendPerWeek > 0
                    ? 'text-emerald-500'
                    : 'text-red-500'
              }`}
            >
              {sleepTrendPerWeek == null ? (
                '—'
              ) : (
                <>
                  {sleepTrendPerWeek > 0 ? '↗' : sleepTrendPerWeek < 0 ? '↘' : '→'} {formatSleepDuration(Math.abs(sleepTrendPerWeek))}/wk
                </>
              )}
            </p>
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

      {tab === 'weight' && weeklyWeight.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-500">Weekly average</h2>
          <ul className="flex flex-col gap-2">
            {weeklyWeight.map((week, i) => {
              const prev = weeklyWeight[i + 1]
              const change = prev ? week.avg - prev.avg : null
              return (
                <li key={week.weekStart} className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Week of {week.weekStart}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{week.avg.toFixed(1)} kg avg</span>
                      {change !== null && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            change > 0
                              ? 'bg-red-100 text-red-600'
                              : change < 0
                                ? 'bg-emerald-100 text-emerald-600'
                                : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {change > 0 ? '+' : ''}
                          {change.toFixed(1)} kg
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-400">
                    {week.min.toFixed(1)} – {week.max.toFixed(1)} kg · {week.entries} log{week.entries === 1 ? '' : 's'}
                  </p>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {tab === 'steps' && weekStepsChange !== null && currentStepsWeek && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-gray-400">This week</p>
            <p className="text-lg font-bold text-gray-900">{Math.round(currentStepsWeek.avg).toLocaleString()}</p>
            <p
              className={`text-sm font-semibold ${
                weekStepsChange > 0 ? 'text-emerald-500' : weekStepsChange < 0 ? 'text-red-500' : 'text-gray-400'
              }`}
            >
              {weekStepsChange > 0 ? '+' : ''}
              {Math.round(weekStepsChange).toLocaleString()} vs last week
            </p>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-gray-400">Trend</p>
            <p
              className={`text-lg font-bold ${
                stepsTrendPerWeek == null || Math.round(stepsTrendPerWeek) === 0
                  ? 'text-gray-900'
                  : stepsTrendPerWeek > 0
                    ? 'text-emerald-500'
                    : 'text-red-500'
              }`}
            >
              {stepsTrendPerWeek == null ? (
                '—'
              ) : (
                <>
                  {stepsTrendPerWeek > 0 ? '↗' : stepsTrendPerWeek < 0 ? '↘' : '→'} {Math.round(Math.abs(stepsTrendPerWeek)).toLocaleString()}
                  /wk
                </>
              )}
            </p>
          </div>
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

      {tab === 'steps' && weeklySteps.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-500">Weekly average</h2>
          <ul className="flex flex-col gap-2">
            {weeklySteps.map((week, i) => {
              const prev = weeklySteps[i + 1]
              const change = prev ? week.avg - prev.avg : null
              const metGoal = stepGoal != null && week.avg >= stepGoal
              return (
                <li key={week.weekStart} className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Week of {week.weekStart}</span>
                    <span className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          stepGoal != null
                            ? metGoal
                              ? 'bg-emerald-100 text-emerald-600'
                              : 'bg-amber-100 text-amber-600'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {Math.round(week.avg).toLocaleString()} avg
                      </span>
                      {change !== null && (
                        <span
                          className={`text-xs font-medium ${
                            change > 0 ? 'text-emerald-500' : change < 0 ? 'text-red-500' : 'text-gray-400'
                          }`}
                        >
                          {change > 0 ? '+' : ''}
                          {Math.round(change).toLocaleString()}
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-400">
                    {week.min.toLocaleString()} – {week.max.toLocaleString()} · {week.days} day{week.days === 1 ? '' : 's'} logged
                  </p>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {tab === 'cardio' && weekCardioChange !== null && currentCardioWeek && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-gray-400">This week</p>
            <p className="text-lg font-bold text-gray-900">{currentCardioWeek.total.toFixed(1)} km</p>
            <p
              className={`text-sm font-semibold ${
                weekCardioChange > 0 ? 'text-emerald-500' : weekCardioChange < 0 ? 'text-red-500' : 'text-gray-400'
              }`}
            >
              {weekCardioChange > 0 ? '+' : ''}
              {weekCardioChange.toFixed(1)} km vs last week
            </p>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-gray-400">Trend</p>
            <p
              className={`text-lg font-bold ${
                cardioTrendPerWeek == null || Math.abs(cardioTrendPerWeek) < 0.05
                  ? 'text-gray-900'
                  : cardioTrendPerWeek > 0
                    ? 'text-emerald-500'
                    : 'text-red-500'
              }`}
            >
              {cardioTrendPerWeek == null ? (
                '—'
              ) : (
                <>
                  {cardioTrendPerWeek > 0 ? '↗' : cardioTrendPerWeek < 0 ? '↘' : '→'} {Math.abs(cardioTrendPerWeek).toFixed(1)} km/wk
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {tab === 'cardio' && weeklyCardioDistance.chartData.length > 1 && (
        <div className="rounded-3xl border border-gray-100 bg-white p-2 shadow-sm">
          <button onClick={() => setCardioExpanded(true)} className="block w-full text-left">
            <CardioChart data={weeklyCardioDistance.chartData} sportTypes={weeklyCardioDistance.sportTypes} height={192} />
          </button>
          <div className="flex flex-wrap gap-2 px-2 pb-1">
            {weeklyCardioDistance.sportTypes.map((sportType) => {
              const style = getSportStyle(sportType)
              return (
                <span key={sportType} className="flex items-center gap-1 rounded-full bg-gray-50 px-2 py-1 text-xs text-gray-600">
                  <span aria-hidden>{style.icon}</span>
                  {style.label}
                </span>
              )
            })}
          </div>
        </div>
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
            <CardioChart data={weeklyCardioDistance.chartData} sportTypes={weeklyCardioDistance.sportTypes} height={window.innerHeight - 160} />
            <div className="flex flex-wrap gap-2 px-2 pt-2">
              {weeklyCardioDistance.sportTypes.map((sportType) => {
                const style = getSportStyle(sportType)
                return (
                  <span key={sportType} className="flex items-center gap-1 rounded-full bg-gray-50 px-2 py-1 text-xs text-gray-600">
                    <span aria-hidden>{style.icon}</span>
                    {style.label}
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'cardio' && cardioWeeksDesc.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-500">Weekly total</h2>
          <ul className="flex flex-col gap-2">
            {cardioWeeksDesc.map((week, i) => {
              const prev = cardioWeeksDesc[i + 1]
              const change = prev ? week.total - prev.total : null
              return (
                <li key={week.weekStart} className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Week of {week.weekStart}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{week.total.toFixed(1)} km</span>
                      {change !== null && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            change > 0 ? 'bg-emerald-100 text-emerald-600' : change < 0 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {change > 0 ? '+' : ''}
                          {change.toFixed(1)} km
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-gray-400">
                    {Object.entries(week.bySport).map(([sportType, km]) => (
                      <span key={sportType}>
                        {getSportStyle(sportType).icon} {km.toFixed(1)} km
                      </span>
                    ))}
                  </p>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {tab === 'strength' && (weekStrengthChange !== null || weeklyStrengthMinutes.length > 1 || strengthWeeksDesc.length > 0) && (
        <button
          onClick={() => setTrainingTimeOpen((o) => !o)}
          className="flex items-center justify-between text-sm font-semibold text-gray-500"
        >
          <span>Training time</span>
          <span className="text-gray-400">{trainingTimeOpen ? 'Hide ▲' : 'Show ▼'}</span>
        </button>
      )}

      {tab === 'strength' && trainingTimeOpen && weekStrengthChange !== null && currentStrengthWeek && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-gray-400">This week</p>
            <p className="text-lg font-bold text-gray-900">{formatWorkoutDuration(currentStrengthWeek.value * 60)}</p>
            <p
              className={`text-sm font-semibold ${
                weekStrengthChange > 0 ? 'text-emerald-500' : weekStrengthChange < 0 ? 'text-red-500' : 'text-gray-400'
              }`}
            >
              {weekStrengthChange > 0 ? '+' : ''}
              {Math.round(weekStrengthChange)} min vs last week
            </p>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-gray-400">Trend</p>
            <p
              className={`text-lg font-bold ${
                strengthTrendPerWeek == null || Math.round(strengthTrendPerWeek) === 0
                  ? 'text-gray-900'
                  : strengthTrendPerWeek > 0
                    ? 'text-emerald-500'
                    : 'text-red-500'
              }`}
            >
              {strengthTrendPerWeek == null ? (
                '—'
              ) : (
                <>
                  {strengthTrendPerWeek > 0 ? '↗' : strengthTrendPerWeek < 0 ? '↘' : '→'} {Math.round(Math.abs(strengthTrendPerWeek))} min/wk
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {tab === 'strength' && trainingTimeOpen && weeklyStrengthMinutes.length > 1 && (
        <button
          onClick={() => setStrengthExpanded(true)}
          className="block w-full rounded-3xl border border-gray-100 bg-white p-2 text-left shadow-sm"
        >
          <WorkoutsChart data={weeklyStrengthMinutes} color="#e11d48" height={192} unit="min" />
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
            <WorkoutsChart data={weeklyStrengthMinutes} color="#e11d48" height={window.innerHeight - 120} unit="min" />
          </div>
        </div>
      )}

      {tab === 'strength' && trainingTimeOpen && strengthWeeksDesc.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-500">Weekly total</h2>
          <ul className="flex flex-col gap-2">
            {strengthWeeksDesc.map((week, i) => {
              const prev = strengthWeeksDesc[i + 1]
              const change = prev ? week.value - prev.value : null
              return (
                <li key={week.weekStart} className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Week of {week.weekStart}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{formatWorkoutDuration(week.value * 60)}</span>
                      {change !== null && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            change > 0 ? 'bg-emerald-100 text-emerald-600' : change < 0 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {change > 0 ? '+' : ''}
                          {Math.round(change)} min
                        </span>
                      )}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {loading || tab === 'food' ? null : (
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="flex items-center justify-between text-sm font-semibold text-gray-500"
        >
          <span>Recent {TAB_LABELS[tab]}</span>
          <span className="text-gray-400">{showHistory ? 'Hide ▲' : 'Show ▼'}</span>
        </button>
      )}

      {!loading && tab !== 'food' && showHistory && (tab === 'cardio' || tab === 'strength' ? (
        <>
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
                        <button onClick={() => setConfirmDeleteWorkout(workout)} className="text-gray-300">
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
                <button onClick={() => setConfirmDeleteEntry(entry)} className="text-gray-300">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </>
      ))}

      <ConfirmDialog
        open={confirmDeleteEntry !== null}
        title={`Remove this ${confirmDeleteEntry ? ENTRY_TYPE_LABELS[confirmDeleteEntry.type] ?? 'entry' : 'entry'}?`}
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirmDeleteEntry) remove(confirmDeleteEntry)
          setConfirmDeleteEntry(null)
        }}
        onCancel={() => setConfirmDeleteEntry(null)}
      />

      <ConfirmDialog
        open={confirmDeleteWorkout !== null}
        title={`Remove "${confirmDeleteWorkout?.name ?? ''}"?`}
        message="This removes the synced Strava workout from your log."
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirmDeleteWorkout) removeWorkout(confirmDeleteWorkout)
          setConfirmDeleteWorkout(null)
        }}
        onCancel={() => setConfirmDeleteWorkout(null)}
      />
    </div>
  )
}
