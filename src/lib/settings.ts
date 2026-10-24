import { findOption } from './optionStore'

// Single values the app runs on (sleep target, rest timer, payday, …): `options` rows of kind
// 'setting' with meta {value, min, max, step, unit} (migration 0052), edited in place next to what
// they drive (src/components/SettingChips.tsx). Pure — the check scripts seed optionStore.

export type SettingKey =
  | 'sleep_target_hours'
  | 'rest_timer_seconds'
  | 'set_target_min'
  | 'set_target_max'
  | 'kg_step_small'
  | 'kg_step_large'
  | 'kg_step_threshold'
  | 'checkin_day_starts_hour'
  | 'payday'
  | 'notable_sleep_hours'
  | 'notable_steps'
  | 'notable_cardio_km'
  | 'notable_strength_min'
  | 'notable_intake_kcal'
  | 'min_logged_kcal'
  | 'min_logged_days'

/**
 * A setting's value. Every key is seeded by 0052, so a missing row is a broken install, not a
 * state to design for — it throws rather than silently using a number baked in here.
 */
export function setting(key: SettingKey): number {
  const value = Number(findOption('setting', key)?.meta.value)
  if (!Number.isFinite(value)) throw new Error(`Missing setting "${key}" — run migration 0052.`)
  return value
}
