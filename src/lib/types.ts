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
}

export type JournalEntryType = 'weight' | 'mood' | 'note' | 'steps' | 'sleep_hours'

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
