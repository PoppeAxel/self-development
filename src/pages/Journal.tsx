import { useEffect, useState } from 'react'
import { AreaChart, Area, BarChart, Bar, ReferenceLine, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { parseISO } from 'date-fns'
import { supabase } from '../lib/supabase'
import { todayISO, weekStartISO } from '../lib/dates'
import { CATEGORY_STYLES } from '../lib/categories'
import { THEME } from '../lib/theme'
import { Screen, HeroSegments, HeroChip } from '../components/Screen'
import { GymPrograms } from '../components/GymPrograms'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { RECOMMENDED_SLEEP_HOURS, formatSleepDuration } from '../lib/sleep'
import { formatWorkoutDuration, formatWorkoutDistance, isStrengthWorkout, getSportStyle } from '../lib/workouts'
import { logEntryMacros } from '../lib/food'
import type {
  FoodLogEntry,
  Ingredient,
  JournalEntry,
  JournalEntryType,
  Recipe,
  RecipeIngredient,
  Workout,
} from '../lib/types'

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
const ENTRY_TYPE_LABELS: Partial<Record<JournalEntryType, string>> = {
  weight: 'weight entry',
  sleep_hours: 'sleep entry',
  steps: 'steps entry',
}

// Each metric keeps its own hue, carried on the week-list accent edge and its chart bars,
// so the Weight weeks and the Steps weeks don't read as the same list. Weight is plum,
// matching the design; the rest take the category hue that fits what they measure.
const METRIC_HUE: Record<JournalTab, (typeof CATEGORY_STYLES)[keyof typeof CATEGORY_STYLES]> = {
  weight: CATEGORY_STYLES.violet,
  sleep_hours: CATEGORY_STYLES.sky,
  steps: CATEGORY_STYLES.emerald,
  cardio: CATEGORY_STYLES.pink,
  strength: CATEGORY_STYLES.amber,
}

// A hero chip that reads good or bad — pine tint for the direction you want, rose for the
// other. Plain glass chips (no judgement attached) use HeroChip instead.
function DeltaChip({ good, children }: { good: boolean; children: React.ReactNode }) {
  const style = good ? CATEGORY_STYLES.emerald : CATEGORY_STYLES.rose
  return (
    <span
      className="rounded-full px-[11px] py-[5px] text-xs font-semibold"
      style={{ background: style.tint, color: style.ink }}
    >
      {children}
    </span>
  )
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

// Shared recharts styling for the calm palette — warm grid lines, off-white tooltip,
// muted axis ink. Passed as props rather than set in CSS since recharts draws to SVG.
const AXIS = { stroke: THEME.inkMuted, fontSize: 10 } as const
const GRID_STROKE = THEME.chartGrid
const TOOLTIP_STYLE = {
  background: THEME.surface,
  border: `1px solid ${THEME.line}`,
  fontSize: 12,
  borderRadius: 12,
  color: THEME.ink,
} as const

function WeightChart({ data, goalWeight, height }: { data: { date: string; value: number }[]; goalWeight: number | null; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="weightFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={THEME.pine} stopOpacity={0.26} />
            <stop offset="100%" stopColor={THEME.pine} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
        <XAxis dataKey="date" {...AXIS} />
        <YAxis
          {...AXIS}
          domain={[
            (dataMin: number) => Math.floor(Math.min(dataMin, goalWeight ?? dataMin) - 2),
            (dataMax: number) => Math.ceil(Math.max(dataMax, goalWeight ?? dataMax) + 2),
          ]}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        {goalWeight != null && (
          <ReferenceLine
            y={goalWeight}
            stroke={THEME.pine}
            strokeWidth={2}
            strokeDasharray="6 5"
            ifOverflow="extendDomain"
            label={{ value: `Goal ${goalWeight} kg`, fontSize: 10, fontWeight: 600, fill: '#1f6b5c', position: 'insideTopLeft' }}
          />
        )}
        <Area
          type="monotone"
          dataKey="value"
          stroke={THEME.pine}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="url(#weightFill)"
          dot={{ r: 2.5, fill: THEME.pine, strokeWidth: 0 }}
          activeDot={{ r: 4.5, fill: '#fff', stroke: THEME.pine, strokeWidth: 2.5 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function StepsChart({ data, stepGoal, height }: { data: { date: string; value: number }[]; stepGoal: number | null; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
        <XAxis dataKey="date" {...AXIS} />
        <YAxis {...AXIS} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        {stepGoal != null && (
          <ReferenceLine
            y={stepGoal}
            stroke={THEME.pine}
            strokeWidth={2}
            strokeDasharray="6 5"
            ifOverflow="extendDomain"
            label={{ value: `Goal ${stepGoal.toLocaleString()}`, fontSize: 10, fontWeight: 600, fill: '#1f6b5c', position: 'insideTopLeft' }}
          />
        )}
        <Bar dataKey="value" fill={METRIC_HUE.steps.accent} radius={[4, 4, 0, 0]} isAnimationActive={false} />
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
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
        <XAxis dataKey="date" {...AXIS} />
        <YAxis {...AXIS} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
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
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
        <XAxis dataKey="date" {...AXIS} />
        <YAxis {...AXIS} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
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
  const [foodEntries, setFoodEntries] = useState<FoodLogEntry[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [recipeLines, setRecipeLines] = useState<Map<string, RecipeIngredient[]>>(new Map())
  const [ingredients, setIngredients] = useState<Ingredient[]>([])

  useEffect(() => {
    setShowHistory(false)
  }, [tab])

  async function load() {
    setLoading(true)
    const [
      { data },
      { data: settingsRow },
      { data: workoutRows },
      { data: foodEntryRows },
      { data: recipeRows },
      { data: recipeLineRows },
      { data: ingredientRows },
    ] = await Promise.all([
      supabase.from('journal_entries').select('*').order('date', { ascending: true }).limit(200),
      supabase.from('user_settings').select('*').maybeSingle(),
      supabase.from('workouts').select('*').order('date', { ascending: true }).limit(200),
      // 60 days is comfortably more than the 28-day window the calorie-estimate card
      // averages over — see foodDailyKcal below.
      supabase.from('food_log_entries').select('*').order('date', { ascending: true }).limit(400),
      supabase.from('recipes').select('*'),
      supabase.from('recipe_ingredients').select('*'),
      supabase.from('ingredients').select('*'),
    ])
    setEntries(data ?? [])
    setGoalWeight(settingsRow?.goal_weight != null ? Number(settingsRow.goal_weight) : null)
    setStepGoal(settingsRow?.step_goal != null ? Number(settingsRow.step_goal) : null)
    setWorkouts(workoutRows ?? [])
    setFoodEntries(foodEntryRows ?? [])
    setRecipes(recipeRows ?? [])
    const byRecipe = new Map<string, RecipeIngredient[]>()
    for (const line of recipeLineRows ?? []) {
      const arr = byRecipe.get(line.recipe_id) ?? []
      arr.push(line)
      byRecipe.set(line.recipe_id, arr)
    }
    setRecipeLines(byRecipe)
    setIngredients(ingredientRows ?? [])
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

  // Estimated maintenance calories from the current trend: how many calories you've
  // actually been eating (avg over logged days) vs. how your weight has been moving
  // over the same stretch. Deliberately doesn't touch workout-calorie estimates —
  // those are unreliable, and unnecessary anyway: weight change already nets out
  // training along with everything else, so it's the only "calories out" signal used.
  // 1 kg of body-mass change ≈ 7700 kcal (standard estimate for fat mass).
  const recipesById = new Map(recipes.map((r) => [r.id, r]))
  const ingredientsById = new Map(ingredients.map((i) => [i.id, i]))
  const kcalByDate = new Map<string, number>()
  for (const e of foodEntries) {
    const kcal = logEntryMacros(e, recipesById, recipeLines, ingredientsById).kcal
    kcalByDate.set(e.date, (kcalByDate.get(e.date) ?? 0) + kcal)
  }
  const CALORIE_WINDOW_DAYS = 28
  const calorieWindowStart = new Date()
  calorieWindowStart.setDate(calorieWindowStart.getDate() - CALORIE_WINDOW_DAYS)
  const calorieWindowStartStr = calorieWindowStart.toISOString().slice(0, 10)
  const recentDailyKcal = [...kcalByDate.entries()].filter(([date]) => date >= calorieWindowStartStr).map(([, kcal]) => kcal)
  const avgDailyKcal =
    recentDailyKcal.length > 0 ? recentDailyKcal.reduce((a, b) => a + b, 0) / recentDailyKcal.length : null

  // Require a handful of logged days and an established weight trend before showing
  // this — a couple of data points either way would make the estimate meaningless.
  const MIN_LOGGED_DAYS_FOR_ESTIMATE = 5
  const showCalorieEstimate = avgDailyKcal != null && recentDailyKcal.length >= MIN_LOGGED_DAYS_FOR_ESTIMATE && weightTrendPerWeek != null
  const estimatedMaintenanceKcal = showCalorieEstimate ? avgDailyKcal! - (weightTrendPerWeek! * 7700) / 7 : null
  const dailyDeficitOrSurplus = showCalorieEstimate ? avgDailyKcal! - estimatedMaintenanceKcal! : null

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

  // The screen's headline number, shown big on the hero: the latest weight, or the
  // current week's figure for the synced metrics. Chips beside it carry the change.
  const heroStat: { value: string; unit?: string; chips: React.ReactNode } | null =
    tab === 'weight' && latestWeightEntry?.value_numeric != null
      ? {
          value: (latestWeightEntry.value_numeric as number).toFixed(1),
          unit: 'kg',
          chips: (
            <>
              {totalWeightChange !== null && (
                <DeltaChip good={totalWeightChange <= 0}>
                  {totalWeightChange > 0 ? '+' : ''}
                  {totalWeightChange.toFixed(1)} kg
                </DeltaChip>
              )}
              {goalWeight != null && distanceToGoal !== null && (
                <HeroChip>
                  {Math.abs(distanceToGoal) <= 0.05 ? 'goal reached 🎉' : `${Math.abs(distanceToGoal).toFixed(1)} to goal`}
                </HeroChip>
              )}
            </>
          ),
        }
      : tab === 'sleep_hours' && currentSleepWeek
        ? {
            value: formatSleepDuration(currentSleepWeek.avg),
            unit: 'avg',
            chips: weekSleepChange !== null && (
              <DeltaChip good={weekSleepChange >= 0}>
                {weekSleepChange > 0 ? '+' : '−'}
                {formatSleepDuration(Math.abs(weekSleepChange))}
              </DeltaChip>
            ),
          }
        : tab === 'steps' && currentStepsWeek
          ? {
              value: Math.round(currentStepsWeek.avg).toLocaleString(),
              unit: 'avg/day',
              chips: (
                <>
                  {weekStepsChange !== null && (
                    <DeltaChip good={weekStepsChange >= 0}>
                      {weekStepsChange > 0 ? '+' : ''}
                      {Math.round(weekStepsChange).toLocaleString()}
                    </DeltaChip>
                  )}
                  {stepGoal != null && <HeroChip>goal {stepGoal.toLocaleString()}</HeroChip>}
                </>
              ),
            }
          : tab === 'cardio' && currentCardioWeek
            ? {
                value: currentCardioWeek.total.toFixed(1),
                unit: 'km this week',
                chips: weekCardioChange !== null && (
                  <DeltaChip good={weekCardioChange >= 0}>
                    {weekCardioChange > 0 ? '+' : ''}
                    {weekCardioChange.toFixed(1)} km
                  </DeltaChip>
                ),
              }
            : tab === 'strength' && currentStrengthWeek
              ? {
                  value: formatWorkoutDuration(currentStrengthWeek.value * 60),
                  unit: 'this week',
                  chips: weekStrengthChange !== null && (
                    <DeltaChip good={weekStrengthChange >= 0}>
                      {weekStrengthChange > 0 ? '+' : ''}
                      {Math.round(weekStrengthChange)} min
                    </DeltaChip>
                  ),
                }
              : null

  const hero = (
    <>
      <HeroSegments options={TABS.map((t) => ({ id: t, label: TAB_LABELS[t] }))} value={tab} onChange={setTab} />
      {heroStat && (
        <div className="mt-5 flex items-end justify-between gap-3">
          <p className="text-[40px] font-semibold leading-none">
            {heroStat.value}
            {heroStat.unit && <span className="ml-1 text-lg font-medium">{heroStat.unit}</span>}
          </p>
          <span className="flex flex-wrap justify-end gap-1.5">{heroStat.chips}</span>
        </div>
      )}
    </>
  )

  return (
    <Screen title="Journal" onRefresh={load} hero={hero}>
      {tab === 'weight' && (
        <div className="flex gap-2">
          <input
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            type="number"
            step="0.1"
            placeholder="Weight (kg)"
            className="flex-1 rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
          />
          <button
            onClick={() => {
              if (!weight) return
              addEntry('weight', Number(weight), null)
              setWeight('')
            }}
            className="rounded-[20px] bg-pine px-4 py-2.5 font-semibold text-white"
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
            className="min-w-0 flex-1 rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
          />
          <input
            value={sleepMinutesPart}
            onChange={(e) => setSleepMinutesPart(e.target.value)}
            type="number"
            step="1"
            placeholder="Minutes"
            className="min-w-0 flex-1 rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
          />
          <button
            onClick={() => {
              if (!sleepHoursPart && !sleepMinutesPart) return
              const value = (Number(sleepHoursPart) || 0) + (Number(sleepMinutesPart) || 0) / 60
              addEntry('sleep_hours', Math.round(value * 10000) / 10000, null)
              setSleepHoursPart('')
              setSleepMinutesPart('')
            }}
            className="shrink-0 rounded-[20px] bg-pine px-4 py-2.5 font-semibold text-white"
          >
            Log
          </button>
        </div>
      )}

      {tab === 'steps' && <p className="text-sm text-ink-disabled">Synced automatically from Garmin — nothing to log here.</p>}

      {tab === 'cardio' && <p className="text-sm text-ink-disabled">Synced automatically from Strava — nothing to log here.</p>}

      {tab === 'strength' && (
        <>
          <GymPrograms strengthWorkouts={strengthWorkouts} />
          <p className="text-sm text-ink-disabled">Total strength time below is synced automatically from Strava.</p>
        </>
      )}

      {/* Two identically styled cards rather than a filled-vs-white pair — see the
          handoff's "smoother transition" note. */}
      {tab === 'weight' && weekWeightChange !== null && currentWeightWeek && (
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-[22px] border border-line bg-surface px-4 py-3.5 shadow-card">
            <p className="text-xs font-medium text-ink-muted">This week</p>
            <p className="mt-0.5 text-[22px] font-semibold text-ink">{currentWeightWeek.avg.toFixed(1)} kg</p>
            <p
              className={`mt-1 text-xs font-semibold ${
                weekWeightChange > 0 ? 'text-cat-rose-ink' : weekWeightChange < 0 ? 'text-cat-emerald-ink' : 'text-ink-disabled'
              }`}
            >
              {weekWeightChange > 0 ? '+' : ''}
              {weekWeightChange.toFixed(1)} kg
            </p>
          </div>
          <div className="rounded-[22px] border border-line bg-surface px-4 py-3.5 shadow-card">
            <p className="text-xs font-medium text-ink-muted">Trend</p>
            <p
              className={`mt-0.5 text-[22px] font-semibold ${
                weightTrendPerWeek == null || weightTrendPerWeek === 0
                  ? 'text-ink'
                  : weightTrendPerWeek > 0
                    ? 'text-cat-rose-ink'
                    : 'text-cat-emerald-ink'
              }`}
            >
              {weightTrendPerWeek == null ? '—' : (
                <>
                  {weightTrendPerWeek > 0 ? '↗' : weightTrendPerWeek < 0 ? '↘' : '→'} {Math.abs(weightTrendPerWeek).toFixed(2)}
                </>
              )}
            </p>
            <p className="mt-1 text-xs font-medium text-ink-3">kg / week</p>
          </div>
        </div>
      )}

      {/* The hero already carries the current weight and the distance to goal, so all
          that's left of the old start→now card is the projection. */}
      {tab === 'weight' && goalWeight != null && distanceToGoal !== null && Math.abs(distanceToGoal) > 0.05 && (
        <p className="text-xs font-medium text-ink-3">
          {Math.abs(distanceToGoal).toFixed(1)} kg to {distanceToGoal > 0 ? 'lose' : 'gain'} to reach {goalWeight} kg ·{' '}
          {weeksToGoal !== null
            ? `~${Math.ceil(weeksToGoal)} week${Math.ceil(weeksToGoal) === 1 ? '' : 's'} at current trend`
            : "current trend isn't moving toward it"}
        </p>
      )}

      {tab === 'weight' && showCalorieEstimate && (
        <div className="rounded-[22px] border border-line bg-surface px-4 py-3.5 shadow-card">
          <p className="text-xs font-medium text-ink-muted">Maintenance estimate · last {recentDailyKcal.length} logged days</p>
          <p className="mt-0.5 text-[22px] font-semibold text-ink">{Math.round(estimatedMaintenanceKcal!).toLocaleString()} kcal/day</p>
          <p className={`mt-1 text-xs font-semibold ${dailyDeficitOrSurplus! < 0 ? 'text-cat-emerald-ink' : 'text-cat-rose-ink'}`}>
            {Math.round(Math.abs(dailyDeficitOrSurplus!)).toLocaleString()} kcal/day{' '}
            {dailyDeficitOrSurplus! < 0 ? 'deficit' : 'surplus'}
          </p>
        </div>
      )}

      {tab === 'weight' && weightSeries.length > 1 && (
        <button
          onClick={() => setWeightExpanded(true)}
          className="block w-full rounded-3xl border border-line bg-surface p-2 text-left shadow-card"
        >
          <WeightChart data={weightSeries} goalWeight={goalWeight} height={192} />
        </button>
      )}

      {weightExpanded && (
        <div className="fixed inset-0 z-50 flex flex-col bg-page safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-ink">Weight</h2>
            <button onClick={() => setWeightExpanded(false)} className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2">
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
          <div className="rounded-[20px] border border-line bg-surface px-4 py-3 shadow-card">
            <p className="text-xs text-ink-disabled">This week</p>
            <p className="text-lg font-bold text-ink">{formatSleepDuration(currentSleepWeek.avg)}</p>
            <p
              className={`text-sm font-semibold ${
                weekSleepChange > 0 ? 'text-cat-emerald-ink' : weekSleepChange < 0 ? 'text-cat-rose-ink' : 'text-ink-disabled'
              }`}
            >
              {weekSleepChange > 0 ? '+' : ''}
              {formatSleepDuration(Math.abs(weekSleepChange))} {weekSleepChange >= 0 ? 'more' : 'less'} vs last week
            </p>
          </div>
          <div className="rounded-[20px] border border-line bg-surface px-4 py-3 shadow-card">
            <p className="text-xs text-ink-disabled">Trend</p>
            <p
              className={`text-lg font-bold ${
                sleepTrendPerWeek == null || sleepTrendPerWeek === 0
                  ? 'text-ink'
                  : sleepTrendPerWeek > 0
                    ? 'text-cat-emerald-ink'
                    : 'text-cat-rose-ink'
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
        <div className="h-48 rounded-3xl border border-line bg-surface p-2 shadow-card">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sleepSeries} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="date" {...AXIS} />
              <YAxis {...AXIS} domain={[0, sleepYMax]} tickCount={sleepYMax + 1} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [formatSleepDuration(Number(value)), 'Slept']} />
              <ReferenceLine
                y={RECOMMENDED_SLEEP_HOURS}
                stroke={THEME.pine}
                strokeWidth={2}
                strokeDasharray="6 5"
                ifOverflow="extendDomain"
                label={{ value: `${RECOMMENDED_SLEEP_HOURS}h recommended`, fontSize: 10, fontWeight: 600, fill: '#1f6b5c', position: 'insideTopLeft' }}
              />
              <Bar dataKey="value" fill={METRIC_HUE.sleep_hours.accent} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {tab === 'sleep_hours' && weeklySleep.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-ink-3">Weekly average</h2>
          <ul className="flex flex-col gap-2">
            {weeklySleep.map((week) => {
              const metGoal = week.avg >= RECOMMENDED_SLEEP_HOURS
              return (
                <li
                  key={week.weekStart}
                  className="rounded-[20px] border border-line border-l-[5px] bg-surface px-4 py-3 shadow-card"
                  style={{ borderLeftColor: METRIC_HUE[tab].accent }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ink-3">Week of {week.weekStart}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        metGoal ? 'bg-cat-emerald-tint text-cat-emerald-ink' : 'bg-cat-amber-tint text-cat-amber-ink'
                      }`}
                    >
                      {formatSleepDuration(week.avg)} avg
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink-disabled">
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
          <h2 className="mb-2 text-sm font-semibold text-ink-3">Weekly average</h2>
          <ul className="flex flex-col gap-2">
            {weeklyWeight.map((week, i) => {
              const prev = weeklyWeight[i + 1]
              const change = prev ? week.avg - prev.avg : null
              return (
                <li
                  key={week.weekStart}
                  className="rounded-[20px] border border-line border-l-[5px] bg-surface px-4 py-3 shadow-card"
                  style={{ borderLeftColor: METRIC_HUE[tab].accent }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ink-3">Week of {week.weekStart}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{week.avg.toFixed(1)} kg avg</span>
                      {change !== null && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            change > 0
                              ? 'bg-cat-rose-tint text-cat-rose-ink'
                              : change < 0
                                ? 'bg-cat-emerald-tint text-cat-emerald-ink'
                                : 'bg-track text-ink-3'
                          }`}
                        >
                          {change > 0 ? '+' : ''}
                          {change.toFixed(1)} kg
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink-disabled">
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
          <div className="rounded-[20px] border border-line bg-surface px-4 py-3 shadow-card">
            <p className="text-xs text-ink-disabled">This week</p>
            <p className="text-lg font-bold text-ink">{Math.round(currentStepsWeek.avg).toLocaleString()}</p>
            <p
              className={`text-sm font-semibold ${
                weekStepsChange > 0 ? 'text-cat-emerald-ink' : weekStepsChange < 0 ? 'text-cat-rose-ink' : 'text-ink-disabled'
              }`}
            >
              {weekStepsChange > 0 ? '+' : ''}
              {Math.round(weekStepsChange).toLocaleString()} vs last week
            </p>
          </div>
          <div className="rounded-[20px] border border-line bg-surface px-4 py-3 shadow-card">
            <p className="text-xs text-ink-disabled">Trend</p>
            <p
              className={`text-lg font-bold ${
                stepsTrendPerWeek == null || Math.round(stepsTrendPerWeek) === 0
                  ? 'text-ink'
                  : stepsTrendPerWeek > 0
                    ? 'text-cat-emerald-ink'
                    : 'text-cat-rose-ink'
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
          className="block w-full rounded-3xl border border-line bg-surface p-2 text-left shadow-card"
        >
          <StepsChart data={stepsSeries} stepGoal={stepGoal} height={192} />
        </button>
      )}

      {stepsExpanded && (
        <div className="fixed inset-0 z-50 flex flex-col bg-page safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-ink">Steps</h2>
            <button onClick={() => setStepsExpanded(false)} className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2">
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
          <h2 className="mb-2 text-sm font-semibold text-ink-3">Weekly average</h2>
          <ul className="flex flex-col gap-2">
            {weeklySteps.map((week, i) => {
              const prev = weeklySteps[i + 1]
              const change = prev ? week.avg - prev.avg : null
              const metGoal = stepGoal != null && week.avg >= stepGoal
              return (
                <li
                  key={week.weekStart}
                  className="rounded-[20px] border border-line border-l-[5px] bg-surface px-4 py-3 shadow-card"
                  style={{ borderLeftColor: METRIC_HUE[tab].accent }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ink-3">Week of {week.weekStart}</span>
                    <span className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          stepGoal != null
                            ? metGoal
                              ? 'bg-cat-emerald-tint text-cat-emerald-ink'
                              : 'bg-cat-amber-tint text-cat-amber-ink'
                            : 'bg-track text-ink-2'
                        }`}
                      >
                        {Math.round(week.avg).toLocaleString()} avg
                      </span>
                      {change !== null && (
                        <span
                          className={`text-xs font-medium ${
                            change > 0 ? 'text-cat-emerald-ink' : change < 0 ? 'text-cat-rose-ink' : 'text-ink-disabled'
                          }`}
                        >
                          {change > 0 ? '+' : ''}
                          {Math.round(change).toLocaleString()}
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink-disabled">
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
          <div className="rounded-[20px] border border-line bg-surface px-4 py-3 shadow-card">
            <p className="text-xs text-ink-disabled">This week</p>
            <p className="text-lg font-bold text-ink">{currentCardioWeek.total.toFixed(1)} km</p>
            <p
              className={`text-sm font-semibold ${
                weekCardioChange > 0 ? 'text-cat-emerald-ink' : weekCardioChange < 0 ? 'text-cat-rose-ink' : 'text-ink-disabled'
              }`}
            >
              {weekCardioChange > 0 ? '+' : ''}
              {weekCardioChange.toFixed(1)} km vs last week
            </p>
          </div>
          <div className="rounded-[20px] border border-line bg-surface px-4 py-3 shadow-card">
            <p className="text-xs text-ink-disabled">Trend</p>
            <p
              className={`text-lg font-bold ${
                cardioTrendPerWeek == null || Math.abs(cardioTrendPerWeek) < 0.05
                  ? 'text-ink'
                  : cardioTrendPerWeek > 0
                    ? 'text-cat-emerald-ink'
                    : 'text-cat-rose-ink'
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
        <div className="rounded-3xl border border-line bg-surface p-2 shadow-card">
          <button onClick={() => setCardioExpanded(true)} className="block w-full text-left">
            <CardioChart data={weeklyCardioDistance.chartData} sportTypes={weeklyCardioDistance.sportTypes} height={192} />
          </button>
          <div className="flex flex-wrap gap-2 px-2 pb-1">
            {weeklyCardioDistance.sportTypes.map((sportType) => {
              const style = getSportStyle(sportType)
              return (
                <span key={sportType} className="flex items-center gap-1 rounded-full bg-track px-2 py-1 text-xs text-ink-2">
                  <span aria-hidden>{style.icon}</span>
                  {style.label}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {cardioExpanded && (
        <div className="fixed inset-0 z-50 flex flex-col bg-page safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-ink">Cardio</h2>
            <button onClick={() => setCardioExpanded(false)} className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2">
              Close ✕
            </button>
          </div>
          <div className="flex-1 px-2 pb-4">
            <CardioChart data={weeklyCardioDistance.chartData} sportTypes={weeklyCardioDistance.sportTypes} height={window.innerHeight - 160} />
            <div className="flex flex-wrap gap-2 px-2 pt-2">
              {weeklyCardioDistance.sportTypes.map((sportType) => {
                const style = getSportStyle(sportType)
                return (
                  <span key={sportType} className="flex items-center gap-1 rounded-full bg-track px-2 py-1 text-xs text-ink-2">
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
          <h2 className="mb-2 text-sm font-semibold text-ink-3">Weekly total</h2>
          <ul className="flex flex-col gap-2">
            {cardioWeeksDesc.map((week, i) => {
              const prev = cardioWeeksDesc[i + 1]
              const change = prev ? week.total - prev.total : null
              return (
                <li
                  key={week.weekStart}
                  className="rounded-[20px] border border-line border-l-[5px] bg-surface px-4 py-3 shadow-card"
                  style={{ borderLeftColor: METRIC_HUE[tab].accent }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ink-3">Week of {week.weekStart}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{week.total.toFixed(1)} km</span>
                      {change !== null && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            change > 0 ? 'bg-cat-emerald-tint text-cat-emerald-ink' : change < 0 ? 'bg-cat-rose-tint text-cat-rose-ink' : 'bg-track text-ink-3'
                          }`}
                        >
                          {change > 0 ? '+' : ''}
                          {change.toFixed(1)} km
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-ink-disabled">
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
          className="flex items-center justify-between text-sm font-semibold text-ink-3"
        >
          <span>Training time</span>
          <span className="text-ink-disabled">{trainingTimeOpen ? 'Hide ▲' : 'Show ▼'}</span>
        </button>
      )}

      {tab === 'strength' && trainingTimeOpen && weekStrengthChange !== null && currentStrengthWeek && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-[20px] border border-line bg-surface px-4 py-3 shadow-card">
            <p className="text-xs text-ink-disabled">This week</p>
            <p className="text-lg font-bold text-ink">{formatWorkoutDuration(currentStrengthWeek.value * 60)}</p>
            <p
              className={`text-sm font-semibold ${
                weekStrengthChange > 0 ? 'text-cat-emerald-ink' : weekStrengthChange < 0 ? 'text-cat-rose-ink' : 'text-ink-disabled'
              }`}
            >
              {weekStrengthChange > 0 ? '+' : ''}
              {Math.round(weekStrengthChange)} min vs last week
            </p>
          </div>
          <div className="rounded-[20px] border border-line bg-surface px-4 py-3 shadow-card">
            <p className="text-xs text-ink-disabled">Trend</p>
            <p
              className={`text-lg font-bold ${
                strengthTrendPerWeek == null || Math.round(strengthTrendPerWeek) === 0
                  ? 'text-ink'
                  : strengthTrendPerWeek > 0
                    ? 'text-cat-emerald-ink'
                    : 'text-cat-rose-ink'
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
          className="block w-full rounded-3xl border border-line bg-surface p-2 text-left shadow-card"
        >
          <WorkoutsChart data={weeklyStrengthMinutes} color={METRIC_HUE.strength.accent} height={192} unit="min" />
        </button>
      )}

      {strengthExpanded && (
        <div className="fixed inset-0 z-50 flex flex-col bg-page safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-ink">Strength</h2>
            <button
              onClick={() => setStrengthExpanded(false)}
              className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2"
            >
              Close ✕
            </button>
          </div>
          <div className="flex-1 px-2 pb-4">
            <WorkoutsChart data={weeklyStrengthMinutes} color={METRIC_HUE.strength.accent} height={window.innerHeight - 120} unit="min" />
          </div>
        </div>
      )}

      {tab === 'strength' && trainingTimeOpen && strengthWeeksDesc.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-ink-3">Weekly total</h2>
          <ul className="flex flex-col gap-2">
            {strengthWeeksDesc.map((week, i) => {
              const prev = strengthWeeksDesc[i + 1]
              const change = prev ? week.value - prev.value : null
              return (
                <li
                  key={week.weekStart}
                  className="rounded-[20px] border border-line border-l-[5px] bg-surface px-4 py-3 shadow-card"
                  style={{ borderLeftColor: METRIC_HUE[tab].accent }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ink-3">Week of {week.weekStart}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{formatWorkoutDuration(week.value * 60)}</span>
                      {change !== null && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            change > 0 ? 'bg-cat-emerald-tint text-cat-emerald-ink' : change < 0 ? 'bg-cat-rose-tint text-cat-rose-ink' : 'bg-track text-ink-3'
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

      {loading ? null : (
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="flex items-center justify-between text-sm font-semibold text-ink-3"
        >
          <span>Recent {TAB_LABELS[tab]}</span>
          <span className="text-ink-disabled">{showHistory ? 'Hide ▲' : 'Show ▼'}</span>
        </button>
      )}

      {!loading && showHistory && (tab === 'cardio' || tab === 'strength' ? (
        <>
          {(() => {
            const list = tab === 'cardio' ? recentCardioWorkouts : recentStrengthWorkouts
            const badgeStyle = tab === 'cardio' ? 'bg-cat-pink-tint text-cat-pink-ink' : 'bg-cat-amber-tint text-cat-amber-ink'
            return (
              <>
                {list.length === 0 && <p className="text-sm text-ink-disabled">Nothing synced yet.</p>}
                <ul className="flex flex-col gap-2 pb-4">
                  {list.map((workout) => {
                    const distance = formatWorkoutDistance(workout.distance_meters)
                    return (
                      <li
                        key={workout.id}
                        className="flex items-center justify-between rounded-[20px] border border-line bg-surface px-4 py-3 text-sm shadow-card"
                      >
                        <span className="text-ink-disabled">{workout.date}</span>
                        <span className="flex-1 px-3">
                          <span className="font-medium text-ink">{workout.name}</span>
                          <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${badgeStyle}`}>{workout.sport_type}</span>
                          <span className="block text-[11px] text-ink-disabled">
                            {formatWorkoutDuration(workout.duration_seconds)}
                            {distance && ` · ${distance}`}
                            {workout.calories != null && ` · ${workout.calories} cal`}
                          </span>
                        </span>
                        <button onClick={() => setConfirmDeleteWorkout(workout)} className="text-ink-faint">
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
          {recent.length === 0 && <p className="text-sm text-ink-disabled">Nothing logged yet.</p>}
          <ul className="flex flex-col gap-2 pb-4">
            {recent.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between rounded-[20px] border border-line bg-surface px-4 py-3 text-sm shadow-card"
              >
                <span className="text-ink-disabled">{entry.date}</span>
                <span className="flex-1 px-3 font-medium text-ink">
                  {entry.type === 'weight' && `${entry.value_numeric} kg`}
                  {entry.type === 'sleep_hours' && entry.value_numeric != null && `${formatSleepDuration(entry.value_numeric)} slept`}
                  {entry.type === 'steps' && entry.value_numeric != null && `${entry.value_numeric.toLocaleString()} steps`}
                </span>
                <button onClick={() => setConfirmDeleteEntry(entry)} className="text-ink-faint">
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
    </Screen>
  )
}
