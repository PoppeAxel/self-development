// Fixed muscle-group taxonomy for the exercise catalog (src/components/GymPrograms.tsx).
// Kept as a flat list rather than a DB enum so adding a category is a one-line change.
export const MUSCLE_GROUPS = [
  'Chest',
  'Triceps',
  'Shoulders',
  'Upper back',
  'Lower back',
  'Biceps',
  'Forearms',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Calves',
  'Core',
  'Full body',
] as const

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number]

// Rolls the 13 muscle groups up into a handful of body regions for a compact overview
// (src/components/GymPrograms.tsx's Muscle balance section) — the full per-muscle
// breakdown is still available by expanding a region.
export const MUSCLE_REGIONS: Record<string, MuscleGroup[]> = {
  Push: ['Chest', 'Shoulders', 'Triceps'],
  Pull: ['Upper back', 'Lower back', 'Biceps'],
  Legs: ['Quads', 'Hamstrings', 'Glutes', 'Calves'],
  Core: ['Core', 'Full body'],
  Forearms: ['Forearms'],
}

// The big compound lifts worth tracking progress on — matched against
// gym_session_sets.exercise_name (exact, case-insensitive) so a variant like "Romanian
// deadlift" doesn't get conflated with "Deadlift".
export const TRACKED_LIFTS = ['Squat', 'Bench press', 'Deadlift', 'Military press (overhead press)'] as const

// Epley formula: estimates the weight you could lift for a single rep, so sets at
// different rep ranges (e.g. 50kg×10 vs 60kg×6) become comparable on one scale.
// Accurate to within a few percent for reps up to ~10-12; treat as a trend indicator,
// not a literal max.
export function estimatedOneRepMax(weight: number, reps: number): number {
  if (reps <= 1) return weight
  return weight * (1 + reps / 30)
}

export interface LiftPoint {
  date: string
  e1rm: number
}

// Average of the most recent sessions, so a single off day (poor sleep, fatigue) doesn't
// swing the headline number the way comparing two isolated sessions would.
export function recentAverage(points: LiftPoint[], window = 3): number {
  const recent = points.slice(-window)
  return recent.reduce((sum, p) => sum + p.e1rm, 0) / recent.length
}

// Least-squares regression slope of e1RM against time, in kg per week. Fits a line
// through every logged session rather than just comparing two points, so one unusually
// good or bad session pulls the trend only a little instead of defining it entirely.
// Returns null when there isn't enough data (or spread) to fit a meaningful line.
export function liftTrendPerWeek(points: LiftPoint[]): number | null {
  if (points.length < 3) return null
  const xs = points.map((p) => new Date(p.date).getTime() / 86_400_000) // days since epoch
  const ys = points.map((p) => p.e1rm)
  const n = xs.length
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY)
    den += (xs[i] - meanX) ** 2
  }
  if (den === 0) return null
  return (num / den) * 7
}
