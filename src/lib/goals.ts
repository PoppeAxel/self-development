import { supabase } from './supabase'
import { weekStartISO } from './dates'
import type { WeeklyGoal } from './types'

// Ensures every recurring goal series has a row for the current week, carrying forward
// title/target/category from its most recent instance. Safe to call on every page load.
export async function rolloverRecurringGoals() {
  const currentWeekStart = weekStartISO()
  const { data: recurring } = await supabase
    .from('weekly_goals')
    .select('*')
    .eq('recurring', true)
    .order('week_start', { ascending: false })

  if (!recurring?.length) return

  const latestBySeries = new Map<string, WeeklyGoal>()
  for (const goal of recurring as WeeklyGoal[]) {
    if (!latestBySeries.has(goal.series_id)) latestBySeries.set(goal.series_id, goal)
  }

  const toCreate = [...latestBySeries.values()].filter((g) => g.week_start < currentWeekStart)
  if (!toCreate.length) return

  await supabase.from('weekly_goals').insert(
    toCreate.map((g) => ({
      user_id: g.user_id,
      title: g.title,
      target_value: g.target_value,
      week_start: currentWeekStart,
      progress: 0,
      status: 'active',
      series_id: g.series_id,
      recurring: true,
    })),
  )
}
