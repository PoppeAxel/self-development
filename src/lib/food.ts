import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { CATEGORY_STYLES } from './categories'
import type { FoodLogEntry, Ingredient, MealType, Recipe, RecipeIngredient } from './types'

export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']

export const MEAL_TYPE_INFO: Record<MealType, { label: string; icon: string }> = {
  breakfast: { label: 'Breakfast', icon: '🌅' },
  lunch: { label: 'Lunch', icon: '🥪' },
  dinner: { label: 'Dinner', icon: '🍽' },
  snack: { label: 'Snack', icon: '🍎' },
}

/**
 * One identity per meal — accent, tint, ink and glyph — so the meal strip, the entries
 * card, the usuals chips and the recipe cards all colour the same meal the same way.
 * Before this there were two disagreeing maps in Food.tsx (MEAL_HUE gave dinner
 * terracotta, RECIPE_MEAL_ACCENT gave it slate blue); terracotta won.
 *
 * The hues are the category palette's, not new values: breakfast ochre, lunch pine,
 * dinner terracotta, snack plum.
 */
export const MEAL_LOOK: Record<MealType, { accent: string; tint: string; ink: string; icon: string }> = {
  breakfast: { ...pick('amber'), icon: MEAL_TYPE_INFO.breakfast.icon },
  lunch: { ...pick('emerald'), icon: MEAL_TYPE_INFO.lunch.icon },
  dinner: { ...pick('pink'), icon: MEAL_TYPE_INFO.dinner.icon },
  snack: { ...pick('violet'), icon: MEAL_TYPE_INFO.snack.icon },
}

function pick(color: keyof typeof CATEGORY_STYLES) {
  const { accent, tint, ink } = CATEGORY_STYLES[color]
  return { accent, tint, ink }
}

/**
 * "yesterday" for the day before `reference`, the weekday name within the last week, and
 * "d MMM" beyond that — the caption on a recent chip, which is there to tell you at a
 * glance whether this was last night's dinner or one from a fortnight ago.
 */
export function relativeDayLabel(date: string, reference: string): string {
  const days = differenceInCalendarDays(parseISO(reference), parseISO(date))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days > 1 && days < 7) return format(parseISO(date), 'EEEE')
  return format(parseISO(date), 'd MMM')
}

// Guess a reasonable default meal when logging food, based on time of day — just a
// starting point in the picker, never enforced (always overridable).
export function defaultMealTypeForNow(): MealType {
  const hour = new Date().getHours()
  if (hour < 10) return 'breakfast'
  if (hour < 15) return 'lunch'
  if (hour < 21) return 'dinner'
  return 'snack'
}

// Suggested ingredient categories — quick-tap starting points in the ingredient form,
// not an enforced enum (ingredients.category is free text, so a custom value works too).
export const INGREDIENT_CATEGORIES = [
  'Protein',
  'Vegetable',
  'Fruit',
  'Dairy',
  'Grains & Carbs',
  'Fats & Oils',
  'Sauces & Condiments',
  'Spices & Seasoning',
  'Sweets & Snacks',
  'Beverages',
] as const

export interface Macros {
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber: number
}

export const ZERO_MACROS: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }

export function scaleMacros(per100g: Macros, grams: number): Macros {
  const factor = grams / 100
  return {
    kcal: per100g.kcal * factor,
    protein: per100g.protein * factor,
    carbs: per100g.carbs * factor,
    fat: per100g.fat * factor,
    fiber: per100g.fiber * factor,
  }
}

export function addMacros(a: Macros, b: Macros): Macros {
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
    fiber: a.fiber + b.fiber,
  }
}

export function ingredientMacros(ingredient: Ingredient): Macros {
  return {
    kcal: ingredient.kcal_per_100g,
    protein: ingredient.protein_per_100g,
    carbs: ingredient.carbs_per_100g,
    fat: ingredient.fat_per_100g,
    fiber: ingredient.fiber_per_100g,
  }
}

// Total macros for the whole recipe (all servings combined) from its ingredient lines.
export function recipeTotalMacros(lines: RecipeIngredient[], ingredientsById: Map<string, Ingredient>): Macros {
  return lines.reduce((sum, line) => {
    const ingredient = ingredientsById.get(line.ingredient_id)
    if (!ingredient) return sum
    return addMacros(sum, scaleMacros(ingredientMacros(ingredient), line.grams))
  }, ZERO_MACROS)
}

export function recipePerServingMacros(recipe: Recipe, lines: RecipeIngredient[], ingredientsById: Map<string, Ingredient>): Macros {
  const total = recipeTotalMacros(lines, ingredientsById)
  const servings = recipe.servings || 1
  return {
    kcal: total.kcal / servings,
    protein: total.protein / servings,
    carbs: total.carbs / servings,
    fat: total.fat / servings,
    fiber: total.fiber / servings,
  }
}

// Macros for one food_log_entries row, given lookup maps for its referenced recipe/ingredient.
export function logEntryMacros(
  entry: FoodLogEntry,
  recipesById: Map<string, Recipe>,
  recipeLinesByRecipe: Map<string, RecipeIngredient[]>,
  ingredientsById: Map<string, Ingredient>,
): Macros {
  if (entry.recipe_id) {
    const recipe = recipesById.get(entry.recipe_id)
    if (!recipe) return ZERO_MACROS
    const lines = recipeLinesByRecipe.get(entry.recipe_id) ?? []
    const perServing = recipePerServingMacros(recipe, lines, ingredientsById)
    return scaleMacros(perServing, (entry.servings ?? 1) * 100)
  }
  if (entry.ingredient_id) {
    const ingredient = ingredientsById.get(entry.ingredient_id)
    if (!ingredient) return ZERO_MACROS
    return scaleMacros(ingredientMacros(ingredient), entry.grams ?? 0)
  }
  return ZERO_MACROS
}

// Folds accented characters to their plain form (kycklingfilé → kycklingfile, ägg → agg)
// so a query typed without diacritics still matches — most people don't bother typing é/å
// on a phone keyboard mid-search. NFD decomposes accented letters into base+combining-mark
// pairs; stripping the combining marks (U+0300–U+036f) leaves the plain base letter.
const COMBINING_DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g')

function foldDiacritics(s: string): string {
  return s.normalize('NFD').replace(COMBINING_DIACRITICS, '')
}

// A query word matches if it's a plain substring of the name, OR — for a compound word
// with no space (e.g. "kycklingfile") — if it can be split into two halves that both
// appear in the name, even with something else between them. This covers official names
// that insert an extra word the user's shorthand skips, e.g. "kycklingfile" naturally
// means "Kyckling bröstfilé" (chicken BREAST fillet) — literally missing "bröst" — which
// a plain substring or even a two-word "kyckling filé" search can't bridge on its own.
function wordMatches(name: string, word: string): boolean {
  if (name.includes(word)) return true
  for (let i = 3; i <= word.length - 3; i++) {
    if (name.includes(word.slice(0, i)) && name.includes(word.slice(i))) return true
  }
  return false
}

// Matches if every word in the query appears somewhere in the name, independent of word
// order or exact phrasing — so "ägg nudlar" matches a name like "Nudlar, ägg" just as well
// as "Ägg nudlar", and a single word like "nudlar" matches regardless of where in the name
// it falls. Diacritic-folded on both sides first (see foldDiacritics).
export function matchesSearch(name: string, query: string): boolean {
  const normalizedName = foldDiacritics(name.toLowerCase())
  const words = foldDiacritics(query.toLowerCase()).trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  return words.every((w) => wordMatches(normalizedName, w))
}

// --- Livsmedelsverket (Swedish Food Agency) open food-composition API ---
// Free, no API key, CORS-open. https://dataportal.livsmedelsverket.se/livsmedel
// License: CC BY 4.0 — "Livsmedelsverket" must be credited as the source (see Settings).
const LIVSMEDELSVERKET_BASE = 'https://dataportal.livsmedelsverket.se/livsmedel/api/v1'

export interface LivsmedelsverketFood {
  nummer: number
  namn: string
}

// The API's list endpoint only supports offset/limit paging — no server-side name
// filter — so search means fetching the ~2,600-item catalog (id + name only, ~1.5MB)
// once per session and filtering client-side. Module-level cache/in-flight promise so
// repeated searches (and StrictMode double-invokes) don't refetch.
let catalogPromise: Promise<LivsmedelsverketFood[]> | null = null

async function loadCatalog(): Promise<LivsmedelsverketFood[]> {
  if (!catalogPromise) {
    catalogPromise = fetch(`${LIVSMEDELSVERKET_BASE}/livsmedel?limit=3000`)
      .then((res) => (res.ok ? res.json() : { livsmedel: [] }))
      .then((data) => (data.livsmedel ?? []).map((f: { nummer: number; namn: string }) => ({ nummer: f.nummer, namn: f.namn })))
      .catch(() => [])
  }
  return catalogPromise
}

export async function searchLivsmedelsverket(query: string): Promise<LivsmedelsverketFood[]> {
  if (!query.trim()) return []
  const catalog = await loadCatalog()
  return catalog.filter((f) => matchesSearch(f.namn, query)).slice(0, 25)
}

// The API's naringsvarden endpoint returns one flat array of nutrient rows per food,
// identified by their Swedish display name (euroFIRkod "ENERC" covers both kJ and kcal
// rows, so `namn` is the only reliable disambiguator).
const NUTRIENT_NAMES = {
  kcal: 'Energi (kcal)',
  protein: 'Protein',
  carbs: 'Kolhydrater, tillgängliga',
  fat: 'Fett, totalt',
  fiber: 'Fiber',
} as const

export async function fetchLivsmedelsverketMacros(nummer: number): Promise<Macros | null> {
  const res = await fetch(`${LIVSMEDELSVERKET_BASE}/livsmedel/${nummer}/naringsvarden`)
  if (!res.ok) return null
  const rows: { namn: string; varde: number }[] = await res.json()
  const byName = new Map(rows.map((r) => [r.namn, r.varde]))
  return {
    kcal: byName.get(NUTRIENT_NAMES.kcal) ?? 0,
    protein: byName.get(NUTRIENT_NAMES.protein) ?? 0,
    carbs: byName.get(NUTRIENT_NAMES.carbs) ?? 0,
    fat: byName.get(NUTRIENT_NAMES.fat) ?? 0,
    fiber: byName.get(NUTRIENT_NAMES.fiber) ?? 0,
  }
}

// --- Open Food Facts (barcode lookup) ---
// Livsmedelsverket has no barcode/GTIN field at all — it's a food-composition database,
// not a retail product catalog — so branded/packaged products go through Open Food
// Facts instead, keyed by barcode. Free, no API key, CORS-open (Access-Control-Allow-
// Origin: *). Community-sourced, so coverage/accuracy varies — always shown to the user
// for review before saving, same as a Livsmedelsverket import.
const OPEN_FOOD_FACTS_BASE = 'https://world.openfoodfacts.org/api/v2/product'

export interface OpenFoodFactsProduct {
  name: string
  macros: Macros
}

export async function fetchOpenFoodFactsProduct(barcode: string): Promise<OpenFoodFactsProduct | null> {
  const res = await fetch(
    `${OPEN_FOOD_FACTS_BASE}/${encodeURIComponent(barcode)}.json?fields=product_name,nutriments`,
  )
  if (!res.ok) return null
  const data = await res.json()
  if (data.status !== 1 || !data.product) return null
  const n = data.product.nutriments ?? {}
  return {
    name: data.product.product_name || `Barcode ${barcode}`,
    macros: {
      kcal: n['energy-kcal_100g'] ?? 0,
      protein: n['proteins_100g'] ?? 0,
      carbs: n['carbohydrates_100g'] ?? 0,
      fat: n['fat_100g'] ?? 0,
      fiber: n['fiber_100g'] ?? 0,
    },
  }
}

// --- One-tap logging ---
// Most days repeat: the same breakfast, the same handful of recipes. These pick the
// candidates worth offering as a single tap, so logging a normal day doesn't mean
// searching for things already logged dozens of times.

export interface MealUsual {
  ref: { kind: 'recipe' | 'ingredient'; id: string }
  /** The quantity it was last logged at FOR THIS MEAL — servings or grams. */
  quantity: number
  name: string
  /** kcal at that quantity, not per serving. */
  kcal: number
  /** How many times it has been logged for this meal. */
  count: number
  lastDate: string
  icon: string
}

export interface MealUsuals {
  /** Last few distinct things logged for this meal, newest first. */
  recent: MealUsual[]
  /** Most-logged for this meal, minus anything already in `recent`. */
  frequent: MealUsual[]
}

function entryRefKey(entry: FoodLogEntry): string | null {
  if (entry.recipe_id) return `recipe:${entry.recipe_id}`
  if (entry.ingredient_id) return `ingredient:${entry.ingredient_id}`
  return null
}

/**
 * What you usually eat for ONE meal, split into recent and frequent.
 *
 * This replaced `quickLogSuggestions`, which tallied the whole day and anchored its rows
 * to one clock-derived meal — so opening the page at 13:00 to log lunch could offer
 * yesterday's dinner alongside two breakfast items. Everything here is filtered to
 * `mealType` first, which is the actual fix.
 *
 * Entries with `meal_type: null` belong to no meal and appear in neither list.
 *
 * `describe` stays the page's callback — it owns the recipe/ingredient maps.
 */
export function mealUsuals(
  entries: FoodLogEntry[],
  mealType: MealType,
  describe: (
    ref: { kind: 'recipe' | 'ingredient'; id: string },
    quantity: number,
  ) => { name: string; kcal: number; icon: string } | null,
  limits: { recent: number; frequent: number } = { recent: 3, frequent: 5 },
): MealUsuals {
  const tally = new Map<string, { ref: { kind: 'recipe' | 'ingredient'; id: string }; count: number; latest: FoodLogEntry }>()
  for (const entry of entries) {
    if (entry.meal_type !== mealType) continue
    const key = entryRefKey(entry)
    if (!key) continue
    const ref = entry.recipe_id
      ? ({ kind: 'recipe', id: entry.recipe_id } as const)
      : ({ kind: 'ingredient', id: entry.ingredient_id as string } as const)
    const existing = tally.get(key)
    if (existing) {
      existing.count += 1
      if (entry.date > existing.latest.date) existing.latest = entry
    } else {
      tally.set(key, { ref, count: 1, latest: entry })
    }
  }

  const build = ([, { ref, count, latest }]: [string, { ref: { kind: 'recipe' | 'ingredient'; id: string }; count: number; latest: FoodLogEntry }]): MealUsual | null => {
    const quantity = ref.kind === 'recipe' ? (latest.servings ?? 1) : (latest.grams ?? 0)
    const described = describe(ref, quantity)
    if (!described) return null
    return { ref, quantity, name: described.name, kcal: described.kcal, count, lastDate: latest.date, icon: described.icon }
  }

  const all = [...tally.entries()]
  const recent = all
    .sort((a, b) => b[1].latest.date.localeCompare(a[1].latest.date))
    .map(build)
    .filter((u): u is MealUsual => u !== null)
    .slice(0, limits.recent)

  const recentKeys = new Set(recent.map((u) => `${u.ref.kind}:${u.ref.id}`))
  // Deduped: a ref in `recent` never repeats in `frequent`, so the two lists together read
  // as one set of options rather than the same dinner twice.
  const frequent = all
    .filter(([key]) => !recentKeys.has(key))
    .sort((a, b) => b[1].count - a[1].count)
    .map(build)
    .filter((u): u is MealUsual => u !== null)
    .slice(0, limits.frequent)

  return { recent, frequent }
}

// --- Recipe & Library browsing ---
// Both lists want the same two facts about every recipe/ingredient: how often it's been
// logged, and when it was last used. Counted once from the already-loaded entries rather
// than a query per row.

export interface LogCounts {
  byRecipe: Map<string, number>
  byIngredient: Map<string, number>
  /** Most recent date each was logged, for "recently used" sorting and the recents shelf. */
  lastRecipe: Map<string, string>
  lastIngredient: Map<string, string>
}

export function logCounts(entries: FoodLogEntry[]): LogCounts {
  const counts: LogCounts = {
    byRecipe: new Map(),
    byIngredient: new Map(),
    lastRecipe: new Map(),
    lastIngredient: new Map(),
  }
  for (const entry of entries) {
    if (entry.recipe_id) {
      counts.byRecipe.set(entry.recipe_id, (counts.byRecipe.get(entry.recipe_id) ?? 0) + 1)
      const seen = counts.lastRecipe.get(entry.recipe_id)
      if (!seen || entry.date > seen) counts.lastRecipe.set(entry.recipe_id, entry.date)
    } else if (entry.ingredient_id) {
      counts.byIngredient.set(entry.ingredient_id, (counts.byIngredient.get(entry.ingredient_id) ?? 0) + 1)
      const seen = counts.lastIngredient.get(entry.ingredient_id)
      if (!seen || entry.date > seen) counts.lastIngredient.set(entry.ingredient_id, entry.date)
    }
  }
  return counts
}

export const UNCATEGORIZED = 'Uncategorized'

/**
 * How each ingredient category presents itself: a glyph, the tile tint behind it, and the
 * accent its rows carry. Keys match INGREDIENT_CATEGORIES; anything else (the category
 * field is free text) falls back to the neutral entry.
 */
export const CATEGORY_LOOK: Record<string, { glyph: string; tint: string; accent: string }> = {
  Protein: { glyph: '🥩', tint: '#f6ebe4', accent: '#a8563f' },
  Vegetable: { glyph: '🥦', tint: '#e8efe8', accent: '#2f6b5a' },
  Fruit: { glyph: '🍎', tint: '#f7efdf', accent: '#a8842f' },
  Dairy: { glyph: '🥛', tint: '#e8edf4', accent: '#46608f' },
  'Grains & Carbs': { glyph: '🍞', tint: '#f1ecf2', accent: '#6a4f7a' },
  'Fats & Oils': { glyph: '🫗', tint: '#efe9dc', accent: '#8b8577' },
  'Sauces & Condiments': { glyph: '🫙', tint: '#efe9dc', accent: '#8b8577' },
  'Spices & Seasoning': { glyph: '🧂', tint: '#efe9dc', accent: '#8b8577' },
  'Sweets & Snacks': { glyph: '🍫', tint: '#efe9dc', accent: '#8b8577' },
  Beverages: { glyph: '🥤', tint: '#efe9dc', accent: '#8b8577' },
  [UNCATEGORIZED]: { glyph: '🧂', tint: '#efe9dc', accent: '#8b8577' },
}

const CUSTOM_CATEGORY_LOOK = { glyph: '🏷', tint: '#efe9dc', accent: '#8b8577' }

export function categoryLook(category: string) {
  return CATEGORY_LOOK[category] ?? CUSTOM_CATEGORY_LOOK
}

/**
 * Category keys in display order: the known list first, then custom ones A–Z, then
 * Uncategorized last — never hidden, since `category` is free text and drifts.
 */
export function orderedCategoryKeys(present: Iterable<string>): string[] {
  const keys = new Set(present)
  const known = INGREDIENT_CATEGORIES as readonly string[]
  const custom = [...keys].filter((k) => k !== UNCATEGORIZED && !known.includes(k)).sort((a, b) => a.localeCompare(b))
  return [...known, ...custom, UNCATEGORIZED].filter((k) => keys.has(k))
}

export function groupByCategory(ingredients: Ingredient[]): Map<string, Ingredient[]> {
  const groups = new Map<string, Ingredient[]>()
  for (const ingredient of ingredients) {
    const key = ingredient.category ?? UNCATEGORIZED
    const arr = groups.get(key) ?? []
    arr.push(ingredient)
    groups.set(key, arr)
  }
  return groups
}

/**
 * A day totalling less than this is treated as incompletely logged rather than as a real
 * intake day, and is left out of every calorie *average* (the maintenance estimate, and
 * the weekly intake averages the Weekly review reads). Pontus doesn't eat 300 kcal
 * days — a total that low means a meal never got logged, and averaging it in drags the
 * estimate down exactly like a missing day would if missing days counted as zero.
 *
 * The logs themselves are untouched: the Food tab's day list and daily-calorie chart still
 * show what was actually logged. This only governs what an average is allowed to average.
 */
export const MIN_LOGGED_KCAL = 1000

/**
 * kcal per date across a set of log entries. Journal's maintenance estimate and
 * weekly.ts's intakeKcalWeeks both need exactly this; anything else that needs daily
 * totals should call this rather than walking the entries again.
 */
export function dailyKcalTotals(
  foodEntries: FoodLogEntry[],
  recipes: Recipe[],
  recipeLines: Map<string, RecipeIngredient[]>,
  ingredients: Ingredient[],
): Map<string, number> {
  const recipesById = new Map(recipes.map((r) => [r.id, r]))
  const ingredientsById = new Map(ingredients.map((i) => [i.id, i]))
  const kcalByDate = new Map<string, number>()
  for (const entry of foodEntries) {
    const kcal = logEntryMacros(entry, recipesById, recipeLines, ingredientsById).kcal
    kcalByDate.set(entry.date, (kcalByDate.get(entry.date) ?? 0) + kcal)
  }
  return kcalByDate
}
