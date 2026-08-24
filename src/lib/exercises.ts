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
