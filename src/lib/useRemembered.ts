import { useState } from 'react'

// A sub-tab that reopens where you left it (Journal, Food, Economy, Training, Goals) instead of a
// fixed starting tab. Per device only (localStorage) — a convenience, not data — and a stored value
// that's no longer one of `allowed` (a tab since removed) falls back to `initial`.
export function useRemembered<T extends string>(key: string, initial: T, allowed: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(`tab:${key}`) as T | null
      return saved && allowed.includes(saved) ? saved : initial
    } catch {
      return initial
    }
  })
  const set = (next: T) => {
    setValue(next)
    try {
      localStorage.setItem(`tab:${key}`, next)
    } catch {
      // Private mode / storage blocked: it just won't be remembered.
    }
  }
  return [value, set] as const
}
