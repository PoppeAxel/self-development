import { supabase } from './supabase'
import type { CategoryColor } from './types'

// Full literal class names so Tailwind's scanner picks them up (dynamic `bg-${color}-100` won't).
export const CATEGORY_STYLES: Record<CategoryColor, { bg: string; text: string; dot: string }> = {
  pink: { bg: 'bg-pink-100', text: 'text-pink-600', dot: 'bg-pink-500' },
  amber: { bg: 'bg-amber-100', text: 'text-amber-600', dot: 'bg-amber-500' },
  violet: { bg: 'bg-violet-100', text: 'text-violet-600', dot: 'bg-violet-500' },
  emerald: { bg: 'bg-emerald-100', text: 'text-emerald-600', dot: 'bg-emerald-500' },
  sky: { bg: 'bg-sky-100', text: 'text-sky-600', dot: 'bg-sky-500' },
  rose: { bg: 'bg-rose-100', text: 'text-rose-600', dot: 'bg-rose-500' },
}

const DEFAULT_CATEGORIES: { name: string; color: CategoryColor }[] = [
  { name: 'Training', color: 'pink' },
  { name: 'Health', color: 'emerald' },
  { name: 'Work', color: 'sky' },
  { name: 'General', color: 'violet' },
]

export async function ensureDefaultCategories() {
  const { count } = await supabase.from('categories').select('id', { count: 'exact', head: true })
  if (count) return
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('categories').insert(DEFAULT_CATEGORIES.map((c) => ({ ...c, user_id: user.id })))
}
