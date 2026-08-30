export const CATEGORY_COLORS = ['pink', 'amber', 'violet', 'emerald', 'sky', 'rose'] as const
export type CategoryColor = (typeof CATEGORY_COLORS)[number]

export interface Category {
  id: string
  user_id: string
  name: string
  color: CategoryColor
}

export interface DailyTask {
  id: string
  user_id: string
  title: string
  active: boolean
  created_at: string
  category_id: string | null
  goal_series_id: string | null
  auto_metric: string | null
  auto_metric_target: number | null
  recurring: boolean
  scheduled_date: string | null
}

export interface TaskCompletion {
  id: string
  user_id: string
  task_id: string
  date: string
  completed_at: string
}

export interface WeeklyGoal {
  id: string
  user_id: string
  title: string
  target_value: number | null
  progress: number
  week_start: string
  status: 'active' | 'done'
  series_id: string
  recurring: boolean
  auto_metric: string | null
}

export type JournalEntryType = 'weight' | 'mood' | 'note' | 'steps' | 'sleep_hours' | 'cardio_minutes' | 'strength_minutes'

export interface JournalEntry {
  id: string
  user_id: string
  date: string
  type: JournalEntryType
  value_numeric: number | null
  value_text: string | null
  created_at: string
}

export interface Reminder {
  id: string
  user_id: string
  label: string
  time_of_day: string
  days_of_week: number[]
  enabled: boolean
  task_id: string | null
}

export interface UserSettings {
  user_id: string
  goal_weight: number | null
  step_goal: number | null
}

export interface Workout {
  id: string
  user_id: string
  strava_id: number
  sport_type: string
  name: string
  date: string
  duration_seconds: number
  distance_meters: number | null
  calories: number | null
  created_at: string
}

export interface GymProgram {
  id: string
  user_id: string
  name: string
  created_at: string
}

export interface GymProgramExercise {
  id: string
  user_id: string
  program_id: string
  name: string
  target_sets: number
  target_reps: number
  position: number
  exercise_id: string | null
}

export interface Exercise {
  id: string
  user_id: string
  name: string
  primary_muscle: string | null
  secondary_muscle: string | null
  created_at: string
}

export interface GymSession {
  id: string
  user_id: string
  program_id: string | null
  program_name: string | null
  date: string
  created_at: string
  strava_workout_id: string | null
}

export interface GymSessionSet {
  id: string
  user_id: string
  session_id: string
  exercise_name: string
  set_number: number
  reps: number | null
  weight: number | null
  created_at: string
}

export interface Ingredient {
  id: string
  user_id: string
  name: string
  source: 'livsmedelsverket' | 'manual'
  source_ref: string | null
  kcal_per_100g: number
  protein_per_100g: number
  carbs_per_100g: number
  fat_per_100g: number
  fiber_per_100g: number
  created_at: string
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface Recipe {
  id: string
  user_id: string
  name: string
  servings: number
  meal_type: MealType | null
  created_at: string
}

export interface RecipeIngredient {
  id: string
  user_id: string
  recipe_id: string
  ingredient_id: string
  grams: number
  position: number
}

export interface FoodLogEntry {
  id: string
  user_id: string
  date: string
  recipe_id: string | null
  servings: number | null
  ingredient_id: string | null
  grams: number | null
  meal_type: MealType | null
  created_at: string
}
