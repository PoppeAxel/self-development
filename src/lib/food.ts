import type { FoodLogEntry, Ingredient, Recipe, RecipeIngredient } from './types'

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
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return []
  const catalog = await loadCatalog()
  return catalog.filter((f) => f.namn.toLowerCase().includes(trimmed)).slice(0, 25)
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
