import { useEffect, useState } from 'react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { parseISO } from 'date-fns'
import { supabase } from '../lib/supabase'
import { periodEndISO, todayISO, weekStartISO } from '../lib/dates'
import {
  byTotal,
  cardioDistanceWeeks,
  intakeKcalWeeks,
  journalWeeks,
  shiftWeek,
  strengthMinutesWeeks,
  trendPerWeek,
  weekOverWeek,
  weekRangeLabel,
  type WeekBucket,
} from '../lib/weekly'
import { consistencyByCategory, reviewFigure, weekSentence, type ReviewFigure, type ReviewMetric } from '../lib/review'
import {
  agreement,
  alignWeeks,
  thresholdFinding,
  INSIGHT_METRICS,
  INSIGHT_SPEC,
  SUGGESTED_PAIRINGS,
  type InsightMetric,
} from '../lib/insights'
import { isGoalMetric, resolveGoalProgress } from '../lib/goals'
import { ProgressRing } from '../components/ProgressRing'
import { CATEGORY_STYLES } from '../lib/categories'
import { THEME } from '../lib/theme'
import { Screen, HeroSegments, HeroChip } from '../components/Screen'
import { GymPrograms } from '../components/GymPrograms'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { RECOMMENDED_SLEEP_HOURS, formatSleepDuration } from '../lib/sleep'
import { formatWorkoutDuration, formatWorkoutDistance, isStrengthWorkout, getSportStyle } from '../lib/workouts'
import { logEntryMacros } from '../lib/food'
import type {
  Category,
  Goal,
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
// 'review' is the cross-metric weekly view rather than one metric's tab — it's first in
// the list because it's the one that answers "how did the week go" without picking a
// metric first, which the per-metric tabs can't do.
type JournalTab =
  | Exclude<JournalEntryType, 'cardio_minutes' | 'strength_minutes' | 'mood' | 'note'>
  | 'cardio'
  | 'strength'
  | 'review'
  | 'insights'
const TABS: JournalTab[] = ['review', 'insights', 'weight', 'sleep_hours', 'steps', 'cardio', 'strength']
const TAB_LABELS: Record<JournalTab, string> = {
  review: 'Week',
  insights: 'Insights',
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
  review: CATEGORY_STYLES.emerald,
  insights: CATEGORY_STYLES.sky,
  weight: CATEGORY_STYLES.violet,
  sleep_hours: CATEGORY_STYLES.sky,
  steps: CATEGORY_STYLES.emerald,
  cardio: CATEGORY_STYLES.pink,
  strength: CATEGORY_STYLES.amber,
}

// The Weekly review's six cards, in the order they're drawn. Each carries the same hue its
// own Journal tab uses, so a card and its tab read as the same metric.
const REVIEW_CARDS: { metric: ReviewMetric; label: string; hue: (typeof CATEGORY_STYLES)[keyof typeof CATEGORY_STYLES] }[] = [
  { metric: 'weight', label: 'Weight', hue: CATEGORY_STYLES.violet },
  { metric: 'sleep', label: 'Sleep', hue: CATEGORY_STYLES.sky },
  { metric: 'steps', label: 'Steps', hue: CATEGORY_STYLES.emerald },
  { metric: 'cardio', label: 'Cardio', hue: CATEGORY_STYLES.pink },
  { metric: 'strength', label: 'Strength', hue: CATEGORY_STYLES.amber },
  { metric: 'intake', label: 'Intake', hue: CATEGORY_STYLES.amber },
]

// Renders the `**bold**` spans weekSentence() emits.
function SentenceText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
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

  // Weekly review. Its goal/completion data isn't needed by any other tab, so it loads
  // separately when that tab is open rather than slowing every Journal visit.
  const [reviewWeek, setReviewWeek] = useState(() => weekStartISO())
  const [reviewGoals, setReviewGoals] = useState<Goal[]>([])
  const [reviewGoalProgress, setReviewGoalProgress] = useState<Map<string, { progress: number; isRollup: boolean }>>(new Map())
  const [reviewParent, setReviewParent] = useState<{ child: Goal; parent: Goal; childPct: number; parentPct: number } | null>(null)
  const [reviewConsistency, setReviewConsistency] = useState<{ category: Category; days: number }[]>([])

  // Insights compares two metrics on one weekly axis; these are the two it's showing.
  const [insightA, setInsightA] = useState<InsightMetric>('sleep')
  const [insightB, setInsightB] = useState<InsightMetric>('steps')

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

  // Goals, task completions and categories for the selected review week. Only the Weekly
  // review needs these, so they're fetched on demand instead of in the main load().
  useEffect(() => {
    if (tab !== 'review') return
    let cancelled = false

    async function loadReview() {
      const weekEnd = periodEndISO('week', reviewWeek)
      const [{ data: goalRows }, { data: completionRows }, { data: taskRows }, { data: categoryRows }] = await Promise.all([
        supabase.from('goals').select('*').eq('period_type', 'week').eq('period_start', reviewWeek).order('created_at'),
        supabase.from('task_completions').select('task_id, date').gte('date', reviewWeek).lte('date', weekEnd),
        supabase.from('daily_tasks').select('id, category_id'),
        supabase.from('categories').select('*').order('name'),
      ])
      if (cancelled) return

      const goals = (goalRows ?? []) as Goal[]
      setReviewGoals(goals)
      const progressEntries = await Promise.all(goals.map(async (g) => [g.id, await resolveGoalProgress(g)] as const))
      if (cancelled) return
      setReviewGoalProgress(new Map(progressEntries))

      // The design's "Run 25 km · 68% → feeds Q4: Run 300 km (62%)" line — the first
      // weekly goal that rolls into a parent, plus how far that parent has come.
      const linked = goals.find((g) => g.parent_series_id)
      if (linked?.parent_series_id) {
        const { data: parentRows } = await supabase
          .from('goals')
          .select('*')
          .eq('series_id', linked.parent_series_id)
          .order('period_start', { ascending: false })
          .limit(1)
        const parent = (parentRows ?? [])[0] as Goal | undefined
        if (parent && !cancelled) {
          const parentProgress = await resolveGoalProgress(parent)
          const childProgress = progressEntries.find(([id]) => id === linked.id)?.[1]
          if (!cancelled) {
            setReviewParent({
              child: linked,
              parent,
              childPct: linked.target_value ? Math.min(100, ((childProgress?.progress ?? 0) / linked.target_value) * 100) : 0,
              parentPct: parent.target_value ? Math.min(100, (parentProgress.progress / parent.target_value) * 100) : 0,
            })
          }
        }
      } else if (!cancelled) {
        setReviewParent(null)
      }

      const taskCategory = new Map(
        (taskRows ?? []).filter((t) => t.category_id).map((t) => [t.id as string, t.category_id as string]),
      )
      const daysByCategory = consistencyByCategory(completionRows ?? [], taskCategory)
      const categoriesById = new Map(((categoryRows ?? []) as Category[]).map((c) => [c.id, c]))
      if (cancelled) return
      setReviewConsistency(
        [...daysByCategory.entries()]
          .map(([categoryId, days]) => ({ category: categoriesById.get(categoryId), days }))
          .filter((row): row is { category: Category; days: number } => row.category != null)
          .sort((a, b) => b.days - a.days),
      )
    }

    loadReview()
    return () => {
      cancelled = true
    }
  }, [tab, reviewWeek])

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

  // Weekly aggregation lives in src/lib/weekly.ts — Journal, the Weekly review and
  // Insights all read the same buckets rather than each re-implementing this.
  const weeklySleepAsc = journalWeeks(entries, 'sleep_hours')
  const weeklySleep = [...weeklySleepAsc].reverse().slice(0, 12)
  const { current: currentSleepWeek, change: weekSleepChange } = weekOverWeek(weeklySleepAsc)
  const sleepTrendPerWeek = trendPerWeek(weeklySleepAsc)

  const weeklyWeightAsc = journalWeeks(entries, 'weight')
  const weeklyWeight = [...weeklyWeightAsc].reverse().slice(0, 12)
  const { current: currentWeightWeek, change: weekWeightChange } = weekOverWeek(weeklyWeightAsc)
  const weightTrendPerWeek = trendPerWeek(weeklyWeightAsc)

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

  const weeklyStepsAsc = journalWeeks(entries, 'steps')
  const weeklySteps = [...weeklyStepsAsc].reverse().slice(0, 12)
  const { current: currentStepsWeek, change: weekStepsChange } = weekOverWeek(weeklyStepsAsc)
  const stepsTrendPerWeek = trendPerWeek(weeklyStepsAsc)

  const cardioWorkouts = workouts.filter((w) => !isStrengthWorkout(w.sport_type))
  const strengthWorkouts = workouts.filter((w) => isStrengthWorkout(w.sport_type))
  // The per-sport breakdown is its own shape (a stacked chart needs one key per sport),
  // so it keeps its own pass; the totals and trends come off the shared buckets.
  const weeklyCardioDistance = weeklyDistanceBySport(cardioWorkouts)
  const cardioWeeksAsc = cardioDistanceWeeks(workouts)
  const weeklyStrengthMinutes = strengthMinutesWeeks(workouts)
  const recentCardioWorkouts = [...cardioWorkouts].reverse().slice(0, 20)
  const recentStrengthWorkouts = [...strengthWorkouts].reverse().slice(0, 20)

  const { current: currentCardioWeek, change: weekCardioChange } = weekOverWeek(cardioWeeksAsc, byTotal)
  const cardioTrendPerWeek = trendPerWeek(cardioWeeksAsc, byTotal)
  const cardioWeeksDesc = [...weeklyCardioDistance.weeks].reverse()

  const { current: currentStrengthWeek, change: weekStrengthChange } = weekOverWeek(weeklyStrengthMinutes, byTotal)
  const strengthTrendPerWeek = trendPerWeek(weeklyStrengthMinutes, byTotal)
  // Same 12-week window the list and chart always showed.
  const strengthWeeks12 = weeklyStrengthMinutes.slice(-12)
  const strengthWeeksDesc = [...strengthWeeks12].reverse()
  const strengthChartData = strengthWeeks12.map((w) => ({ date: w.weekStart.slice(5), value: Math.round(w.total) }))

  // --- Weekly review ---
  // Goal weight tells us which way is "good" for weight; without one, treat losing as the
  // intent (that's what every other part of this app assumes) but say so nowhere.
  const intakeWeeks = intakeKcalWeeks(foodEntries, recipes, recipeLines, ingredients)
  const reviewBuckets: Record<ReviewMetric, WeekBucket[]> = {
    weight: weeklyWeightAsc,
    sleep: weeklySleepAsc,
    steps: weeklyStepsAsc,
    cardio: cardioWeeksAsc,
    strength: weeklyStrengthMinutes,
    intake: intakeWeeks,
  }
  const reviewFigures = REVIEW_CARDS.map((card) => ({
    card,
    figure: reviewFigure(card.metric, card.label, reviewBuckets[card.metric], reviewWeek),
  })).filter((row): row is { card: (typeof REVIEW_CARDS)[number]; figure: ReviewFigure } => row.figure != null)

  const reviewSentence = weekSentence(
    weeklyWeightAsc,
    [
      { metric: 'sleep', buckets: weeklySleepAsc },
      { metric: 'steps', buckets: weeklyStepsAsc },
      { metric: 'cardio', buckets: cardioWeeksAsc },
      { metric: 'strength', buckets: weeklyStrengthMinutes },
      { metric: 'intake', buckets: intakeWeeks },
    ],
    reviewWeek,
  )

  // --- Insights ---
  const insightBuckets: Record<InsightMetric, WeekBucket[]> = {
    weight: weeklyWeightAsc,
    sleep: weeklySleepAsc,
    steps: weeklyStepsAsc,
    cardio: cardioWeeksAsc,
    strength: weeklyStrengthMinutes,
    intake: intakeWeeks,
  }
  const insightPairs = alignWeeks(insightBuckets[insightA], insightBuckets[insightB], insightA, insightB)
  const insightChart = insightPairs.map((p) => ({ date: p.weekStart.slice(5), a: p.a, b: p.b }))
  const insightAgreement = agreement(insightPairs)
  const insightFinding = thresholdFinding(insightPairs, insightA, insightB)

  const reviewGoalsDone = reviewGoals.filter((g) => {
    const p = reviewGoalProgress.get(g.id)
    const isAuto = isGoalMetric(g.auto_metric) || p?.isRollup
    return isAuto ? g.target_value != null && (p?.progress ?? 0) >= g.target_value : g.status === 'done'
  }).length

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
                  value: formatWorkoutDuration(currentStrengthWeek.total * 60),
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
      {tab === 'review' && (
        <>
          <div className="mt-[18px] flex items-center justify-between gap-2 rounded-[18px] bg-white/14 px-2.5 py-[7px]">
            <button
              onClick={() => setReviewWeek((w) => shiftWeek(w, -1))}
              aria-label="Previous week"
              className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-white/18 text-white"
            >
              ‹
            </button>
            <span className="truncate text-sm font-medium text-white">{weekRangeLabel(reviewWeek)}</span>
            <button
              onClick={() => setReviewWeek((w) => shiftWeek(w, 1))}
              disabled={reviewWeek >= weekStartISO()}
              aria-label="Next week"
              className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-white/18 text-white disabled:opacity-40"
            >
              ›
            </button>
          </div>
          <p className="mt-[18px] text-[15px] font-medium leading-relaxed text-white">
            {reviewSentence ? (
              <SentenceText text={reviewSentence.text} />
            ) : (
              'Not enough logged this week to compare it to the one before.'
            )}
          </p>
        </>
      )}
      {tab === 'insights' && (
        <>
          <div className="mt-[18px] flex items-center gap-2">
            <select
              value={insightA}
              onChange={(e) => setInsightA(e.target.value as InsightMetric)}
              aria-label="First metric"
              className="min-w-0 flex-1 rounded-2xl bg-surface px-3.5 py-2.5 text-[13px] font-semibold text-pine-dark outline-none"
            >
              {INSIGHT_METRICS.map((m) => (
                <option key={m} value={m}>
                  {INSIGHT_SPEC[m].label}
                </option>
              ))}
            </select>
            <span className="shrink-0 text-xs font-medium text-white">vs</span>
            <select
              value={insightB}
              onChange={(e) => setInsightB(e.target.value as InsightMetric)}
              aria-label="Second metric"
              className="min-w-0 flex-1 rounded-2xl bg-surface px-3.5 py-2.5 text-[13px] font-semibold text-pine-dark outline-none"
            >
              {INSIGHT_METRICS.map((m) => (
                <option key={m} value={m}>
                  {INSIGHT_SPEC[m].label}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-4 text-[15px] font-medium leading-relaxed text-white">
            {insightA === insightB ? (
              'Pick two different metrics to compare.'
            ) : insightFinding ? (
              <SentenceText text={insightFinding} />
            ) : (
              'Not enough weeks logged for both of these yet.'
            )}
          </p>
        </>
      )}
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
    <Screen title={tab === 'review' ? 'Your week' : 'Journal'} onRefresh={load} hero={hero}>
      {tab === 'review' && (
        <>
          {reviewFigures.length === 0 ? (
            <p className="text-sm text-ink-disabled">Nothing logged this week yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {reviewFigures.map(({ card, figure }) => (
                <div
                  key={card.metric}
                  className="flex overflow-hidden rounded-[20px] border border-line bg-surface shadow-card"
                >
                  <span className="w-[5px] shrink-0 self-stretch" style={{ background: card.hue.accent }} />
                  <div className="min-w-0 px-3.5 py-3">
                    <p className="text-xs font-medium text-ink-muted">{figure.label}</p>
                    <p className="mt-0.5 truncate text-xl font-semibold text-ink">{figure.value}</p>
                    <p
                      className={`mt-0.5 text-xs font-semibold ${
                        figure.good === true ? 'text-cat-emerald-ink' : figure.good === false ? 'text-cat-rose-ink' : 'text-ink-muted'
                      }`}
                    >
                      {figure.delta ?? figure.caption ?? '—'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {reviewGoals.length > 0 && (
            <div className="rounded-[22px] border border-line bg-surface p-4 shadow-card">
              <div className="flex items-center gap-3.5">
                <ProgressRing
                  percent={(reviewGoalsDone / reviewGoals.length) * 100}
                  size={52}
                  strokeWidth={5}
                  disc={THEME.surface}
                >
                  <span className="text-[13px] font-semibold text-ink">
                    {reviewGoalsDone}/{reviewGoals.length}
                  </span>
                </ProgressRing>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">Goals this week</p>
                  {reviewParent ? (
                    <p className="mt-0.5 text-xs text-ink-3">
                      {reviewParent.child.title} · {Math.round(reviewParent.childPct)}% → feeds{' '}
                      <strong className="font-semibold text-ink">{reviewParent.parent.title}</strong> (
                      {Math.round(reviewParent.parentPct)}%)
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-ink-3">
                      {reviewGoalsDone} of {reviewGoals.length} done
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {reviewConsistency.length > 0 && (
            <div className="grid grid-cols-2 gap-2.5">
              {reviewConsistency.map(({ category, days }) => {
                const style = CATEGORY_STYLES[category.color]
                return (
                  <div
                    key={category.id}
                    className="flex items-center gap-2.5 rounded-[20px] border border-line bg-surface px-3.5 py-3 shadow-card"
                  >
                    <span
                      className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl text-sm font-semibold"
                      style={{ background: style.tint, color: style.ink }}
                    >
                      {category.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-ink">{days} of 7</span>
                      <span className="block truncate text-[11px] text-ink-muted">{category.name} days</span>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {tab === 'insights' && (
        <>
          {insightA === insightB || insightChart.length < 3 ? (
            <p className="text-sm text-ink-disabled">
              {insightA === insightB
                ? 'Choose a different second metric.'
                : 'Needs at least three weeks where both metrics were logged.'}
            </p>
          ) : (
            <>
              <div className="rounded-3xl border border-line bg-surface p-4 shadow-card">
                <div className="mb-2 flex gap-3.5">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: CATEGORY_STYLES.sky.accent }} />
                    {INSIGHT_SPEC[insightA].label} ({INSIGHT_SPEC[insightA].unit})
                  </span>
                  <span className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
                    <span className="h-[3px] w-4 rounded-sm" style={{ background: THEME.pine }} />
                    {INSIGHT_SPEC[insightB].label} ({INSIGHT_SPEC[insightB].unit})
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <ComposedChart data={insightChart} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                    <XAxis dataKey="date" {...AXIS} />
                    <YAxis yAxisId="a" {...AXIS} width={34} />
                    <YAxis yAxisId="b" orientation="right" {...AXIS} width={38} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(value, name) =>
                        name === 'a'
                          ? [INSIGHT_SPEC[insightA].format(Number(value)), INSIGHT_SPEC[insightA].label]
                          : [INSIGHT_SPEC[insightB].format(Number(value)), INSIGHT_SPEC[insightB].label]
                      }
                    />
                    <Bar
                      yAxisId="a"
                      dataKey="a"
                      fill={CATEGORY_STYLES.sky.accent}
                      fillOpacity={0.85}
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    />
                    <Line
                      yAxisId="b"
                      type="monotone"
                      dataKey="b"
                      stroke={THEME.pine}
                      strokeWidth={2.5}
                      dot={{ r: 3.5, fill: THEME.surface, stroke: THEME.pine, strokeWidth: 2 }}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {insightAgreement && (
                <div className="rounded-[22px] border border-line bg-surface px-4 py-3.5 shadow-card">
                  <p className="text-xs font-medium text-ink-muted">Relationship</p>
                  <p className="mt-0.5 text-xl font-semibold text-ink">{insightAgreement.label}</p>
                  {/* Weeks and moves are different counts — six weeks give five moves,
                      and a flat week is skipped — so the line names both rather than
                      implying one number covers it. */}
                  <p className="mt-1 text-xs text-ink-3">
                    {insightChart.length} weeks · {insightAgreement.agree} of {insightAgreement.compared} weekly moves agree
                  </p>
                </div>
              )}
            </>
          )}

          <p className="mt-1 text-[13px] font-semibold text-ink-3">Other pairings</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_PAIRINGS.map(({ a, b }) => {
              const style = METRIC_HUE[a === 'intake' ? 'strength' : a === 'sleep' ? 'sleep_hours' : a]
              return (
                <button
                  key={`${a}-${b}`}
                  onClick={() => {
                    setInsightA(a)
                    setInsightB(b)
                  }}
                  className="rounded-full px-3.5 py-2 text-xs font-semibold"
                  style={{ background: style.tint, color: style.ink }}
                >
                  {INSIGHT_SPEC[a].label} vs {INSIGHT_SPEC[b].label}
                </button>
              )
            })}
          </div>

          <div className="flex items-start gap-2.5 rounded-[20px] bg-cat-amber-tint px-3.5 py-3">
            <span className="text-[15px]">💡</span>
            <p className="text-xs leading-relaxed text-ink-2">
              Built from your own logs only — no workout-calorie guessing, same principle as the maintenance estimate.
            </p>
          </div>
        </>
      )}

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
                    {formatSleepDuration(week.min)} – {formatSleepDuration(week.max)} · {week.count} night{week.count === 1 ? '' : 's'}{' '}
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
                    {week.min.toFixed(1)} – {week.max.toFixed(1)} kg · {week.count} log{week.count === 1 ? '' : 's'}
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
                    {week.min.toLocaleString()} – {week.max.toLocaleString()} · {week.count} day{week.count === 1 ? '' : 's'} logged
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
            <p className="text-lg font-bold text-ink">{formatWorkoutDuration(currentStrengthWeek.total * 60)}</p>
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
          <WorkoutsChart data={strengthChartData} color={METRIC_HUE.strength.accent} height={192} unit="min" />
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
            <WorkoutsChart data={strengthChartData} color={METRIC_HUE.strength.accent} height={window.innerHeight - 120} unit="min" />
          </div>
        </div>
      )}

      {tab === 'strength' && trainingTimeOpen && strengthWeeksDesc.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-ink-3">Weekly total</h2>
          <ul className="flex flex-col gap-2">
            {strengthWeeksDesc.map((week, i) => {
              const prev = strengthWeeksDesc[i + 1]
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
                      <span className="text-sm font-semibold text-ink">{formatWorkoutDuration(week.total * 60)}</span>
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

      {loading || tab === 'review' || tab === 'insights' ? null : (
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="flex items-center justify-between text-sm font-semibold text-ink-3"
        >
          <span>Recent {TAB_LABELS[tab]}</span>
          <span className="text-ink-disabled">{showHistory ? 'Hide ▲' : 'Show ▼'}</span>
        </button>
      )}

      {!loading && showHistory && tab !== 'review' && tab !== 'insights' && (tab === 'cardio' || tab === 'strength' ? (
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
