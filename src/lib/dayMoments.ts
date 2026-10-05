// Builds the daily check-in diary's "Your day" timeline from data the app already has for
// that date: sleep, weight, steps (journal_entries), finished tasks, Strava workouts, gym
// sessions and food (one moment per meal). Kept out of dailyCheckin.ts so that file stays
// pure. Times are the local time the row was created/completed; Strava rows only store a
// date (created_at is the sync time, not the workout's), so workouts and steps are untimed.
import { format, subDays } from 'date-fns'
import { supabase } from './supabase'
import { addMacros, logEntryMacros, MEAL_TYPE_INFO, ZERO_MACROS } from './food'
import { formatSleepDuration } from './sleep'
import { sortMoments, type Moment } from './dailyCheckin'
import type { FoodLogEntry, Ingredient, MealType, Recipe, RecipeIngredient } from './types'

const hhmm = (ts: string) => format(new Date(ts), 'HH:mm')
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

export async function loadDayMoments(date: string): Promise<Moment[]> {
  const weekAgo = format(subDays(new Date(date + 'T00:00:00'), 7), 'yyyy-MM-dd')
  const [
    { data: journal },
    { data: completions },
    { data: workouts },
    { data: gym },
    { data: food },
    { data: settings },
  ] = await Promise.all([
    supabase.from('journal_entries').select('type, value_numeric, date, created_at').in('type', ['sleep_hours', 'weight', 'steps']).gte('date', weekAgo).lte('date', date).order('created_at'),
    supabase.from('task_completions').select('task_id, completed_at').eq('date', date),
    supabase.from('workouts').select('id, name, distance_meters, duration_seconds').eq('date', date),
    supabase.from('gym_sessions').select('id, program_name, created_at, strava_workout_id, gym_session_sets(exercise_name, reps, weight)').eq('date', date),
    supabase.from('food_log_entries').select('*').eq('date', date),
    supabase.from('user_settings').select('step_goal').maybeSingle(),
  ])
  const moments: Moment[] = []

  // Sleep / weight / steps: today's value, compared with the week before.
  const rows = (journal ?? []).map((r) => ({ ...r, value: Number(r.value_numeric) }))
  const todays = (type: string) => rows.filter((r) => r.type === type && r.date === date).at(-1)
  const before = (type: string) => rows.filter((r) => r.type === type && r.date < date)

  const sleep = todays('sleep_hours')
  if (sleep) {
    const past = before('sleep_hours').map((r) => r.value)
    const diffMin = past.length ? Math.round((sleep.value - avg(past)) * 60) : null
    const vs = diffMin == null ? '' : Math.abs(diffMin) < 10 ? ' · on your avg' : ` · ${Math.abs(diffMin)} min ${diffMin > 0 ? 'over' : 'under'} your avg`
    moments.push({ source: 'sleep', sourceId: '', time: hhmm(sleep.created_at), icon: '🌙', title: `Slept ${formatSleepDuration(sleep.value)}`, meta: `Sleep${vs}` })
  }
  const weight = todays('weight')
  if (weight) {
    const first = before('weight')[0]
    const change = first ? weight.value - first.value : null
    const vs = change == null ? '' : ` · ${change > 0 ? '+' : change < 0 ? '−' : '±'}${Math.abs(change).toFixed(1)} this week`
    moments.push({ source: 'weight', sourceId: '', time: hhmm(weight.created_at), icon: '⚖️', title: `${weight.value} kg`, meta: `Weight${vs}` })
  }
  const steps = todays('steps')
  if (steps) {
    const goal = settings?.step_goal as number | null | undefined
    const vs = goal ? (steps.value >= goal ? ' · goal reached' : ` · ${(goal - steps.value).toLocaleString()} to go`) : ''
    moments.push({ source: 'steps', sourceId: '', time: null, icon: '🚶', title: `${steps.value.toLocaleString()} steps`, meta: `Steps${vs}` })
  }

  // Finished tasks, with their category.
  if (completions?.length) {
    const [{ data: tasks }, { data: categories }] = await Promise.all([
      supabase.from('daily_tasks').select('id, title, category_id').in('id', completions.map((c) => c.task_id)),
      supabase.from('categories').select('id, name'),
    ])
    for (const c of completions) {
      const task = tasks?.find((t) => t.id === c.task_id)
      if (!task) continue
      const category = categories?.find((k) => k.id === task.category_id)?.name
      moments.push({ source: 'task', sourceId: task.id, time: hhmm(c.completed_at), icon: '✓', title: task.title, meta: category ? `Task · ${category}` : 'Task' })
    }
  }

  // Gym sessions; a Strava workout linked to one is the same training, so it's skipped below.
  const linked = new Set((gym ?? []).map((g) => g.strava_workout_id).filter(Boolean))
  for (const g of gym ?? []) {
    const sets = (g.gym_session_sets ?? []) as { exercise_name: string; reps: number | null; weight: number | null }[]
    const exercises = new Set(sets.map((s) => s.exercise_name)).size
    const top = sets.filter((s) => s.weight != null).sort((a, b) => Number(b.weight) - Number(a.weight))[0]
    const meta = ['Gym', `${exercises} exercise${exercises === 1 ? '' : 's'}`, top ? `top ${Number(top.weight)} kg × ${top.reps ?? '?'}` : null]
    moments.push({ source: 'gym', sourceId: g.id, time: hhmm(g.created_at), icon: '🏋️', title: g.program_name ?? 'Gym session', meta: meta.filter(Boolean).join(' · ') })
  }
  for (const w of workouts ?? []) {
    if (linked.has(w.id)) continue
    const km = w.distance_meters ? `${(Number(w.distance_meters) / 1000).toFixed(1)} km` : null
    const meta = ['Strava', km, `${Math.round(w.duration_seconds / 60)} min`]
    moments.push({ source: 'workout', sourceId: w.id, time: null, icon: '🏃', title: w.name, meta: meta.filter(Boolean).join(' · ') })
  }

  // Food: one moment per meal, titled by its biggest item.
  const entries = (food ?? []) as FoodLogEntry[]
  if (entries.length) {
    const [{ data: recipes }, { data: lines }, { data: ingredients }] = await Promise.all([
      supabase.from('recipes').select('*'),
      supabase.from('recipe_ingredients').select('*'),
      supabase.from('ingredients').select('*'),
    ])
    const recipesById = new Map(((recipes ?? []) as Recipe[]).map((r) => [r.id, r]))
    const linesByRecipe = new Map<string, RecipeIngredient[]>()
    for (const l of (lines ?? []) as RecipeIngredient[]) linesByRecipe.set(l.recipe_id, [...(linesByRecipe.get(l.recipe_id) ?? []), l])
    const ingredientsById = new Map(((ingredients ?? []) as Ingredient[]).map((i) => [i.id, i]))
    const kcal = (e: FoodLogEntry) => logEntryMacros(e, recipesById, linesByRecipe, ingredientsById).kcal
    const name = (e: FoodLogEntry) => (e.recipe_id ? recipesById.get(e.recipe_id)?.name : ingredientsById.get(e.ingredient_id ?? '')?.name) ?? 'Food'
    const dayTotal = Math.round(entries.reduce((s, e) => addMacros(s, logEntryMacros(e, recipesById, linesByRecipe, ingredientsById)), ZERO_MACROS).kcal)

    const meals = new Map<string, FoodLogEntry[]>()
    for (const e of entries) meals.set(e.meal_type ?? 'food', [...(meals.get(e.meal_type ?? 'food') ?? []), e])
    for (const [meal, list] of meals) {
      const info = MEAL_TYPE_INFO[meal as MealType] as { label: string; icon: string } | undefined
      const main = [...list].sort((a, b) => kcal(b) - kcal(a))[0]
      const mealKcal = Math.round(list.reduce((s, e) => s + kcal(e), 0))
      const first = list.map((e) => e.created_at).sort()[0]
      moments.push({
        source: 'food',
        sourceId: meal,
        time: hhmm(first),
        icon: info?.icon ?? '🍴',
        title: list.length > 1 ? `${name(main)} +${list.length - 1}` : name(main),
        meta: `${info?.label ?? 'Food'} · ${mealKcal.toLocaleString()} kcal · ${dayTotal.toLocaleString()} today`,
      })
    }
  }

  return sortMoments(moments)
}
