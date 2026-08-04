export interface DailyTask {
  id: string
  user_id: string
  title: string
  active: boolean
  created_at: string
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
}

export type JournalEntryType = 'weight' | 'mood' | 'note'

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
}
