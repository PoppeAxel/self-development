import { supabase } from './supabase'
import type { CategoryColor } from './types'

// One muted hue per category (calm warm-neutral restyle). Each owns a tile tint, a chip
// ink, and an accent used for the 5px card edge, progress bars and ring arcs.
//
// `bg`/`text`/`dot` stay full literal class names so Tailwind's scanner picks them up
// (dynamic `bg-cat-${color}` won't); `accent`/`tint`/`ink` are the same values as hexes,
// for SVG strokes, conic gradients and recharts props that need a value, not a class.
// `check` is the value for ANY white-on-colour fill — done-state circles, filled buttons.
// The handoff's contrast rule: white only goes on the pine hero or on inks at/below
// `#8a6321` luminance, never on a mid-tone accent, so amber steps one shade darker here.
interface CategoryStyle {
  bg: string
  text: string
  dot: string
  accent: string
  tint: string
  ink: string
  check: string
}

export const CATEGORY_STYLES: Record<CategoryColor, CategoryStyle> = {
  pink: {
    bg: 'bg-cat-pink-tint',
    text: 'text-cat-pink-ink',
    dot: 'bg-cat-pink',
    accent: '#a8563f',
    tint: '#f6ebe4',
    ink: '#8a4630',
    check: '#a8563f',
  },
  amber: {
    bg: 'bg-cat-amber-tint',
    text: 'text-cat-amber-ink',
    dot: 'bg-cat-amber',
    accent: '#a8842f',
    tint: '#f7efdf',
    ink: '#8a6321',
    check: '#8a6321',
  },
  violet: {
    bg: 'bg-cat-violet-tint',
    text: 'text-cat-violet-ink',
    dot: 'bg-cat-violet',
    accent: '#6a4f7a',
    tint: '#f1ecf2',
    ink: '#5d4470',
    check: '#6a4f7a',
  },
  emerald: {
    bg: 'bg-cat-emerald-tint',
    text: 'text-cat-emerald-ink',
    dot: 'bg-cat-emerald',
    accent: '#2f6b5a',
    tint: '#e8efe8',
    ink: '#1f6b5c',
    check: '#2f6b5a',
  },
  sky: {
    bg: 'bg-cat-sky-tint',
    text: 'text-cat-sky-ink',
    dot: 'bg-cat-sky',
    accent: '#46608f',
    tint: '#e8edf4',
    ink: '#35528f',
    check: '#46608f',
  },
  rose: {
    bg: 'bg-cat-rose-tint',
    text: 'text-cat-rose-ink',
    dot: 'bg-cat-rose',
    accent: '#a33327',
    tint: '#f8eae4',
    ink: '#a33327',
    check: '#a33327',
  },
}

// The stored `color` values are the original Tailwind hue names, which no longer describe
// what they actually look like after the calm restyle (pink is terracotta now, violet is
// plum). The picker shows these instead; the stored value is untouched.
export const CATEGORY_COLOR_LABELS: Record<CategoryColor, string> = {
  pink: 'Terracotta',
  emerald: 'Pine',
  sky: 'Slate blue',
  violet: 'Plum',
  amber: 'Ochre',
  rose: 'Clay red',
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
  // Multiple pages (Today, Settings) call this on every mount, so two can race here —
  // both see count === 0 above and both try to insert. `ignoreDuplicates` against the
  // (user_id, name) unique constraint makes that harmless instead of creating duplicates.
  await supabase
    .from('categories')
    .upsert(
      DEFAULT_CATEGORIES.map((c) => ({ ...c, user_id: user.id })),
      { onConflict: 'user_id,name', ignoreDuplicates: true },
    )
}
