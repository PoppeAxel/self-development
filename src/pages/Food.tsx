import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { addDays, format, subDays } from 'date-fns'
import { todayISO } from '../lib/dates'
import { Screen, HeroSegments, HeroSearch, ChipRail } from '../components/Screen'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { BarcodeScanner } from '../components/BarcodeScanner'
import {
  addMacros,
  logEntryMacros,
  recipePerServingMacros,
  recipeTotalMacros,
  scaleMacros,
  ingredientMacros,
  searchLivsmedelsverket,
  fetchLivsmedelsverketMacros,
  fetchOpenFoodFactsProduct,
  defaultMealTypeForNow,
  matchesSearch,
  mealUsuals,
  relativeDayLabel,
  MEAL_LOOK,
  logCounts,
  categoryLook,
  groupByCategory,
  orderedCategoryKeys,
  UNCATEGORIZED,
  MEAL_TYPES,
  MEAL_TYPE_INFO,
  INGREDIENT_CATEGORIES,
  ZERO_MACROS,
  type Macros,
  type LivsmedelsverketFood,
} from '../lib/food'
import { CATEGORY_STYLES as CAT } from '../lib/categories'
import { resolveImportedLines, type ImportedRecipe } from '../lib/recipeImport'
import { normalizeUrl, linkHost, linkLabel } from '../lib/links'
import type { FoodLogEntry, Ingredient, MealType, Recipe, RecipeIngredient, SavedLink } from '../lib/types'

function MealTypePicker({ value, onChange }: { value: MealType | null; onChange: (v: MealType | null) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {MEAL_TYPES.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(value === m ? null : m)}
          className={`rounded-xl py-1.5 text-xs font-medium transition ${
            value === m ? 'bg-cat-emerald-tint text-cat-emerald-ink' : 'bg-track text-ink-3'
          }`}
        >
          {MEAL_TYPE_INFO[m].icon} {MEAL_TYPE_INFO[m].label}
        </button>
      ))}
    </div>
  )
}

function round(n: number, decimals = 0) {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

function MacroRow({ macros }: { macros: Macros }) {
  return (
    <p className="text-sm text-ink-3">
      P {round(macros.protein)}g · C {round(macros.carbs)}g · F {round(macros.fat)}g · Fiber {round(macros.fiber)}g
    </p>
  )
}

interface RecipeIngredientRow {
  ingredientId: string
  name: string
  grams: string
  /** The original line this row came from, when it was imported from a URL — kept so an
      unresolved row still shows what it's meant to be ("2 msk olivolja"). */
  importedFrom?: string
  /** Plausible library rows for an unmatched imported line, offered as one-tap chips.
      Never auto-applied — that's the whole point (see resolveLine in recipeImport.ts). */
  suggestions?: { id: string; name: string }[]
}

interface IngredientFormState {
  name: string
  kcal: string
  protein: string
  carbs: string
  fat: string
  fiber: string
  portionLabel: string
  portionGrams: string
  category: string
}

function emptyIngredientForm(): IngredientFormState {
  return { name: '', kcal: '', protein: '', carbs: '', fat: '', fiber: '', portionLabel: '', portionGrams: '', category: '' }
}

// The quantity sheet's presets. Recipes are logged in servings, ingredients in grams;
// anything off-preset goes through the ⌨ escape rather than widening these.
const PRESET_QUANTITIES: Record<'recipe' | 'ingredient', number[]> = {
  recipe: [0.5, 1, 1.5, 2],
  ingredient: [50, 100, 150, 200],
}

const PRESET_LABELS: Record<'recipe' | 'ingredient', string[]> = {
  recipe: ['½', '1', '1½', '2'],
  ingredient: ['50', '100', '150', '200'],
}

type FoodSubTab = 'log' | 'recipes' | 'library' | 'links'
const SUB_TABS: FoodSubTab[] = ['log', 'recipes', 'library', 'links']
const SUB_TAB_LABELS: Record<FoodSubTab, string> = { log: 'Log', recipes: 'Recipes', library: 'Library', links: 'Links' }

type RecipeSort = 'logged' | 'recent' | 'az' | 'kcal'
const RECIPE_SORT_LABELS: Record<RecipeSort, string> = {
  logged: 'Most logged',
  recent: 'Recently used',
  az: 'A–Z',
  kcal: 'kcal / serving',
}

type CategorySort = 'az' | 'used' | 'protein'
const CATEGORY_SORT_LABELS: Record<CategorySort, string> = {
  az: 'A–Z',
  used: 'Most used',
  protein: 'Highest protein',
}
// Mid-sentence forms for the header's "28 ingredients · sorted …" line. A–Z keeps its
// capitals; lowercasing the label wholesale turned it into "a–z".
const CATEGORY_SORT_SUBTITLE: Record<CategorySort, string> = {
  az: 'A–Z',
  used: 'most used',
  protein: 'highest protein',
}

// Protein / carbs / fat, in that order — the same three colours the Log tab's split bar
// uses, so a recipe's balance and a day's balance read the same way.
function MacroSplitBar({ macros, height }: { macros: Macros; height: number }) {
  if (macros.protein + macros.carbs + macros.fat <= 0) return null
  return (
    <div className="flex gap-1" style={{ marginTop: 10 }}>
      <span className="rounded-full" style={{ height, flex: macros.protein, background: '#a8cfc0' }} />
      <span className="rounded-full" style={{ height, flex: macros.carbs, background: '#e0cf9a' }} />
      <span className="rounded-full" style={{ height, flex: macros.fat, background: '#e6b39f' }} />
    </div>
  )
}

export function Food() {
  const [subTab, setSubTab] = useState<FoodSubTab>('log')
  const [recipeSearchQuery, setRecipeSearchQuery] = useState('')
  const [librarySearchQuery, setLibrarySearchQuery] = useState('')
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [recipeLines, setRecipeLines] = useState<Map<string, RecipeIngredient[]>>(new Map())
  const [entries, setEntries] = useState<FoodLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const [logDate, setLogDate] = useState(todayISO())
  // The meal the Log tab is focused on. Always explicit now — seeded from the clock, then
  // whatever you tap. `expandedMeal` is the second stage of the same tile: tapping the
  // already-selected tile opens that meal's entries in place of the usuals sections, so
  // only ever one of the two is expanded.
  const [selectedMeal, setSelectedMeal] = useState<MealType>(() => defaultMealTypeForNow())
  const [expandedMeal, setExpandedMeal] = useState<MealType | null>(null)
  const [addLogOpen, setAddLogOpen] = useState(false)
  const [addLogQuery, setAddLogQuery] = useState('')
  // entryId set means this is editing an existing food_log_entries row (update) rather
  // than logging a new one (insert) — same dialog, same fields, different save target.
  // True once the ⌨ cell is tapped — the numeric field is hidden behind it, since the
  // presets cover almost every log.
  const [quantifyFreeform, setQuantifyFreeform] = useState(false)
  const [mealPickerOpen, setMealPickerOpen] = useState(false)
  // What the sheet says under the presets ("Last time you logged 1 serving"), null when
  // this food has never been logged for this meal.
  const [quantifyLastUsed, setQuantifyLastUsed] = useState<number | null>(null)
  const [quantifying, setQuantifying] = useState<{ kind: 'recipe' | 'ingredient'; id: string; name: string; entryId?: string } | null>(
    null,
  )
  const [quantifyValue, setQuantifyValue] = useState('')
  const [quantifyMealType, setQuantifyMealType] = useState<MealType | null>(null)
  const [confirmDeleteEntry, setConfirmDeleteEntry] = useState<FoodLogEntry | null>(null)

  const [viewingRecipe, setViewingRecipe] = useState<Recipe | null>(null)
  const [recipeBuilderOpen, setRecipeBuilderOpen] = useState(false)
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null)
  const [recipeName, setRecipeName] = useState('')
  const [recipeServings, setRecipeServings] = useState('1')
  const [recipeMealType, setRecipeMealType] = useState<MealType | null>(null)
  const [recipeRows, setRecipeRows] = useState<RecipeIngredientRow[]>([])
  const [pickingIngredientFor, setPickingIngredientFor] = useState<number | 'new' | null>(null)
  const [ingredientPickQuery, setIngredientPickQuery] = useState('')
  const [confirmDeleteRecipe, setConfirmDeleteRecipe] = useState<Recipe | null>(null)

  // Import a recipe from a URL. The fetch and JSON-LD parsing happen in the import-recipe
  // edge function (recipe sites aren't CORS-open); matching the resulting ingredient lines
  // against the library happens here, and anything unmatched is left for the recipe
  // builder to resolve with the pickers it already has.
  const [importOpen, setImportOpen] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  // The site's own per-serving figures, shown beside what the app computes. Never stored —
  // recipes hold no macro columns, macros are always derived from the ingredient rows.
  const [importedNutrition, setImportedNutrition] = useState<ImportedRecipe['statedNutrition']>(null)

  // Saved recipe links (the Links sub-tab). Duplicates are prevented by the unique
  // (user_id, url_key) constraint; the client-side check against the loaded list only
  // exists to say which link it collided with instead of surfacing a constraint error.
  const [links, setLinks] = useState<SavedLink[]>([])
  const [linkUrl, setLinkUrl] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [savingLink, setSavingLink] = useState(false)
  const [linkSearchQuery, setLinkSearchQuery] = useState('')
  // Which saved link's Import button is running — anchors the spinner and any error to
  // that row, since the import sheet isn't open in this path.
  const [importingLinkId, setImportingLinkId] = useState<string | null>(null)
  const [confirmDeleteLink, setConfirmDeleteLink] = useState<SavedLink | null>(null)

  const [ingredientFormOpen, setIngredientFormOpen] = useState(false)
  // 'recipe' means this ingredient is being created from inside the recipe builder's
  // ingredient picker (pickingIngredientFor already holds which row/slot it's for) — on
  // save it gets auto-added to that recipe row instead of just returning to the library.
  const [ingredientFormOrigin, setIngredientFormOrigin] = useState<'library' | 'recipe'>('library')
  const [editingIngredient, setEditingIngredient] = useState<Ingredient | null>(null)
  const [ingredientForm, setIngredientForm] = useState<IngredientFormState>(emptyIngredientForm())
  const [ingredientFormMode, setIngredientFormMode] = useState<'manual' | 'search'>('manual')
  const [lsvQuery, setLsvQuery] = useState('')
  const [lsvResults, setLsvResults] = useState<LivsmedelsverketFood[]>([])
  const [lsvSearching, setLsvSearching] = useState(false)
  const [confirmDeleteIngredient, setConfirmDeleteIngredient] = useState<Ingredient | null>(null)
  const [confirmDuplicateName, setConfirmDuplicateName] = useState<string | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanLookingUp, setScanLookingUp] = useState(false)
  const [scanLookupError, setScanLookupError] = useState<string | null>(null)
  // Target from a "stay under calorie budget" task on Today, when one exists — see kcalLeft.
  const [calorieBudget, setCalorieBudget] = useState<number | null>(null)

  // Recipes browsing: a meal filter ANDed with the text search, plus a sort.
  const [mealTypeFilter, setMealTypeFilter] = useState<MealType | 'all'>('all')
  const [recipeSort, setRecipeSort] = useState<RecipeSort>('logged')
  // Library browsing: categories are collapsed until one is opened as a pushed view.
  const [openCategory, setOpenCategory] = useState<string | null>(null)
  const [categorySort, setCategorySort] = useState<CategorySort>('az')
  const [categorySearch, setCategorySearch] = useState('')

  async function load() {
    setLoading(true)
    const [{ data: ingredientRows }, { data: recipeRowsData }, { data: recipeLineRows }, { data: entryRows }, { data: budgetRow }, { data: linkRows }] =
      await Promise.all([
        supabase.from('ingredients').select('*').order('name'),
        supabase.from('recipes').select('*').order('name'),
        supabase.from('recipe_ingredients').select('*').order('position'),
        supabase.from('food_log_entries').select('*').order('date', { ascending: false }).limit(300),
        supabase
          .from('daily_tasks')
          .select('auto_metric_target')
          .eq('active', true)
          .eq('auto_metric', 'calorie_budget')
          .not('auto_metric_target', 'is', null)
          .limit(1)
          .maybeSingle(),
        supabase.from('saved_links').select('*').order('created_at', { ascending: false }),
      ])
    setCalorieBudget(budgetRow?.auto_metric_target != null ? Number(budgetRow.auto_metric_target) : null)
    const byRecipe = new Map<string, RecipeIngredient[]>()
    for (const line of recipeLineRows ?? []) {
      const arr = byRecipe.get(line.recipe_id) ?? []
      arr.push(line)
      byRecipe.set(line.recipe_id, arr)
    }
    setIngredients(ingredientRows ?? [])
    setRecipes(recipeRowsData ?? [])
    setRecipeLines(byRecipe)
    setEntries(entryRows ?? [])
    setLinks(linkRows ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const ingredientsById = new Map(ingredients.map((i) => [i.id, i]))
  const recipesById = new Map(recipes.map((r) => [r.id, r]))

  // --- Daily log ---

  function openAddLog() {
    setAddLogQuery('')
    setAddLogOpen(true)
  }

  function beginQuantify(kind: 'recipe' | 'ingredient', id: string, name: string, quantity?: number) {
    setQuantifying({ kind, id, name })
    setMealPickerOpen(false)
    // A caller-supplied quantity (the last one actually used) beats any default. Failing
    // that, "1 portion" worth of grams when the ingredient has a standard portion set
    // (e.g. banana → 120g) — a much more useful starting point than a flat 100g.
    const portionGrams = kind === 'ingredient' ? ingredientsById.get(id)?.portion_grams : null
    setQuantifyValue(
      quantity != null ? String(quantity) : kind === 'recipe' ? '1' : portionGrams != null ? String(portionGrams) : '100',
    )
    // The strip's selected meal is now always explicit, so it wins outright: you tapped
    // + under "Dinner", you meant dinner, whatever the recipe is tagged as.
    setQuantifyMealType(selectedMeal)
    setQuantifyFreeform(quantity != null && !PRESET_QUANTITIES[kind].includes(quantity))
    setQuantifyLastUsed(quantity ?? null)
    setAddLogOpen(false)
  }

  // Opens the same quantity/meal dialog as beginQuantify, but pre-filled from an
  // existing log entry and tagged with its id so confirmQuantify updates it in place
  // instead of inserting a new row.
  function beginEditEntry(entry: FoodLogEntry) {
    setMealPickerOpen(false)
    if (entry.recipe_id) {
      const recipe = recipesById.get(entry.recipe_id)
      setQuantifying({ kind: 'recipe', id: entry.recipe_id, name: recipe?.name ?? 'Recipe', entryId: entry.id })
      setQuantifyValue(String(entry.servings ?? 1))
    } else if (entry.ingredient_id) {
      const ingredient = ingredientsById.get(entry.ingredient_id)
      setQuantifying({ kind: 'ingredient', id: entry.ingredient_id, name: ingredient?.name ?? 'Ingredient', entryId: entry.id })
      setQuantifyValue(String(entry.grams ?? 0))
    } else {
      return
    }
    setQuantifyMealType(entry.meal_type ?? selectedMeal)
    const existing = entry.recipe_id ? (entry.servings ?? 1) : (entry.grams ?? 0)
    setQuantifyFreeform(!PRESET_QUANTITIES[entry.recipe_id ? 'recipe' : 'ingredient'].includes(existing))
    setQuantifyLastUsed(null)
  }

  async function confirmQuantify() {
    if (!quantifying) return
    const value = Number(quantifyValue)
    if (!quantifyValue || Number.isNaN(value) || value <= 0) return
    if (quantifying.entryId) {
      const payload = quantifying.kind === 'recipe' ? { servings: value } : { grams: value }
      await supabase.from('food_log_entries').update({ ...payload, meal_type: quantifyMealType }).eq('id', quantifying.entryId)
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const payload =
        quantifying.kind === 'recipe'
          ? { recipe_id: quantifying.id, servings: value, ingredient_id: null, grams: null }
          : { ingredient_id: quantifying.id, grams: value, recipe_id: null, servings: null }
      await supabase.from('food_log_entries').insert({ ...payload, meal_type: quantifyMealType, date: logDate, user_id: user.id })
    }
    setQuantifying(null)
    load()
  }

  async function removeLogEntry(entry: FoodLogEntry) {
    setEntries((es) => es.filter((e) => e.id !== entry.id))
    await supabase.from('food_log_entries').delete().eq('id', entry.id)
  }

  function macrosFor(entry: FoodLogEntry): Macros {
    return logEntryMacros(entry, recipesById, recipeLines, ingredientsById)
  }

  function entryLabel(entry: FoodLogEntry): string {
    if (entry.recipe_id) {
      const recipe = recipesById.get(entry.recipe_id)
      const servings = entry.servings ?? 1
      return `${recipe?.name ?? 'Recipe'}${servings !== 1 ? ` × ${servings}` : ''}`
    }
    const ingredient = entry.ingredient_id ? ingredientsById.get(entry.ingredient_id) : null
    return `${ingredient?.name ?? 'Ingredient'} · ${entry.grams}g`
  }

  const dayEntries = entries.filter((e) => e.date === logDate)
  const dayTotal = dayEntries.reduce((sum, e) => addMacros(sum, macrosFor(e)), ZERO_MACROS)

  // Grouped by meal for display — 'null' (no meal tag, e.g. logged before this feature
  // existed) gets its own bucket rendered last under "Other", rather than being merged
  // into Snack or hidden, so nothing silently disappears from the day's list.
  const dayEntriesByMeal = new Map<MealType | null, FoodLogEntry[]>()
  for (const entry of dayEntries) {
    const arr = dayEntriesByMeal.get(entry.meal_type) ?? []
    arr.push(entry)
    dayEntriesByMeal.set(entry.meal_type, arr)
  }
  // kcal per meal for the strip. A meal with nothing logged is null, not 0 — the tile
  // shows "—" so an untouched meal reads as untouched rather than as a zero-calorie one.
  const mealKcal = new Map<MealType, number | null>(
    MEAL_TYPES.map((meal) => {
      const mealEntries = dayEntriesByMeal.get(meal) ?? []
      if (mealEntries.length === 0) return [meal, null]
      return [meal, mealEntries.reduce((sum, e) => sum + macrosFor(e).kcal, 0)]
    }),
  )
  // Entries logged before meal tagging existed have no meal; they'd be invisible on a
  // meal-first screen, so they keep a bucket of their own under the strip.
  const untaggedEntries = dayEntriesByMeal.get(null) ?? []

  // --- One-tap logging ---

  // What a suggestion row needs to render: name, kcal at that quantity, and an icon.
  // Recipes borrow their meal's glyph; ingredients fall back to a generic one.
  function describeRef(ref: { kind: 'recipe' | 'ingredient'; id: string }, quantity: number) {
    if (ref.kind === 'recipe') {
      const recipe = recipesById.get(ref.id)
      if (!recipe) return null
      const perServing = recipePerServingMacros(recipe, recipeLines.get(recipe.id) ?? [], ingredientsById)
      return {
        name: recipe.name,
        kcal: perServing.kcal * quantity,
        icon: recipe.meal_type ? MEAL_TYPE_INFO[recipe.meal_type].icon : '🍽',
      }
    }
    const ingredient = ingredientsById.get(ref.id)
    if (!ingredient) return null
    return { name: ingredient.name, kcal: scaleMacros(ingredientMacros(ingredient), quantity).kcal, icon: '🥗' }
  }

  // Per meal, not per day — see mealUsuals. Recomputed as the selected meal changes.
  const usuals = mealUsuals(entries, selectedMeal, describeRef)

  // The app deliberately has no global daily calorie goal (days vary too much for one to
  // mean anything). A "stay under budget" task on Today is the one place a target does
  // exist, so the "N left" chip reads from that when there is one, and is absent otherwise.
  const kcalLeft = calorieBudget != null ? calorieBudget - dayTotal.kcal : null

  // Flex weights for the macro split bar — grams, not calories, matching the design.
  const macroGrams = dayTotal.protein + dayTotal.carbs + dayTotal.fat

  // --- Recipes & Library browsing ---
  // Counted once from the entries already loaded, rather than a query per row.
  const counts = logCounts(entries)

  const recipeMacros = (recipe: Recipe) =>
    recipePerServingMacros(recipe, recipeLines.get(recipe.id) ?? [], ingredientsById)

  const recipeMealCounts = new Map<MealType, number>()
  for (const recipe of recipes) {
    if (recipe.meal_type) recipeMealCounts.set(recipe.meal_type, (recipeMealCounts.get(recipe.meal_type) ?? 0) + 1)
  }

  // A recipe with no meal tag belongs to "All" only — it isn't forced into a bucket it
  // was never tagged for, same rule the Log tab's meal sections follow.
  const visibleRecipes = recipes
    .filter((r) => matchesSearch(r.name, recipeSearchQuery))
    .filter((r) => mealTypeFilter === 'all' || r.meal_type === mealTypeFilter)
  const sortedRecipes = [...visibleRecipes].sort((a, b) => {
    switch (recipeSort) {
      case 'logged':
        return (counts.byRecipe.get(b.id) ?? 0) - (counts.byRecipe.get(a.id) ?? 0)
      case 'recent':
        return (counts.lastRecipe.get(b.id) ?? '').localeCompare(counts.lastRecipe.get(a.id) ?? '')
      case 'kcal':
        return recipeMacros(b).kcal - recipeMacros(a).kcal
      case 'az':
        return a.name.localeCompare(b.name)
    }
  })

  // Links already arrive newest-first from the query. The search covers the name and the
  // URL itself, so "ica" finds every link from that site even when none of them is named.
  const visibleLinks = links.filter(
    (l) => matchesSearch(l.title ?? '', linkSearchQuery) || matchesSearch(l.url, linkSearchQuery),
  )

  const ingredientGroups = groupByCategory(ingredients)
  const categoryKeys = orderedCategoryKeys(ingredientGroups.keys())
  const weekAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd')
  const usedThisWeek = new Set(entries.filter((e) => e.ingredient_id && e.date >= weekAgo).map((e) => e.ingredient_id as string))

  // The last few distinct ingredients logged — what most sessions actually reach for.
  const recentIngredients = [...counts.lastIngredient.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([id]) => ingredientsById.get(id))
    .filter((i): i is Ingredient => i != null)
    .slice(0, 8)

  const openCategoryIngredients = openCategory
    ? [...(ingredientGroups.get(openCategory) ?? [])]
        .filter((i) => matchesSearch(i.name, categorySearch))
        .sort((a, b) => {
          switch (categorySort) {
            case 'used':
              return (counts.byIngredient.get(b.id) ?? 0) - (counts.byIngredient.get(a.id) ?? 0)
            case 'protein':
              return b.protein_per_100g - a.protein_per_100g
            case 'az':
              return a.name.localeCompare(b.name)
          }
        })
    : []

  // Opens the quantify dialog straight from a list. The dialog renders above whichever
  // sub-tab you're on, so logging never means leaving the one you were browsing —
  // prefilled with the quantity you last used rather than a default portion.
  function logFromList(kind: 'recipe' | 'ingredient', id: string, name: string) {
    // `entries` comes back date-descending, so the first match is the most recent.
    const previous = entries.find((e) => (kind === 'recipe' ? e.recipe_id === id : e.ingredient_id === id))
    const lastQuantity = previous ? (kind === 'recipe' ? previous.servings : previous.grams) : null
    beginQuantify(kind, id, name, lastQuantity ?? undefined)
  }

  // Live totals for the recipe builder, from whichever rows are resolved so far.
  const builderServings = Number(recipeServings) || 1
  const builderResolvedRows = recipeRows.filter((r) => r.ingredientId && Number(r.grams) > 0)
  const unresolvedRowCount = recipeRows.length - builderResolvedRows.length
  const builderPerServing =
    builderResolvedRows.length > 0
      ? scaleMacros(
          builderResolvedRows.reduce((sum, row) => {
            const ingredient = ingredientsById.get(row.ingredientId)
            return ingredient ? addMacros(sum, scaleMacros(ingredientMacros(ingredient), Number(row.grams))) : sum
          }, ZERO_MACROS),
          // scaleMacros works per 100g, so dividing by servings means scaling by
          // 100/servings rather than 1/servings.
          100 / builderServings,
        )
      : null

  // One ingredient row, used by both the open category and the flat search results.
  // `withCategory` swaps the portion/source caption for which category it's filed under,
  // which is the useful thing to know when results span all of them.
  function renderIngredientRow(ingredient: Ingredient, withCategory: boolean) {
    const key = ingredient.category ?? UNCATEGORIZED
    const look = categoryLook(key)
    const used = counts.byIngredient.get(ingredient.id) ?? 0
    return (
      <div className="flex items-center gap-3 overflow-hidden rounded-[18px] border border-line bg-surface shadow-card">
        <span className="w-[5px] shrink-0 self-stretch" style={{ background: look.accent }} />
        <button
          onClick={() => openEditIngredient(ingredient)}
          className="min-w-0 flex-1 py-2.5 text-left"
          aria-label={`Edit ${ingredient.name}`}
        >
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium text-ink">{ingredient.name}</span>
            {used >= 5 && (
              <span className="shrink-0 rounded-full bg-cat-emerald-tint px-1.5 py-0.5 text-[10px] font-semibold text-cat-emerald-ink">
                used {used}×
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
            {withCategory
              ? key === UNCATEGORIZED
                ? 'Uncategorised'
                : key
              : `${ingredient.kcal_per_100g} kcal/100g · P ${round(ingredient.protein_per_100g)}g C ${round(
                  ingredient.carbs_per_100g,
                )}g F ${round(ingredient.fat_per_100g)}g`}
            {!withCategory && ingredient.portion_label && ingredient.portion_grams
              ? ` · 1 ${ingredient.portion_label} = ${ingredient.portion_grams}g`
              : ''}
            {!withCategory && ingredient.source === 'livsmedelsverket' ? ' · Livsmedelsverket' : ''}
          </span>
        </button>
        <span className="mr-3.5 flex shrink-0 gap-1.5">
          <button
            onClick={() => logFromList('ingredient', ingredient.id, ingredient.name)}
            aria-label={`Log ${ingredient.name}`}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-cat-emerald-tint text-[15px] text-cat-emerald-ink"
          >
            +
          </button>
          <button
            onClick={() => openEditIngredient(ingredient)}
            aria-label={`Edit ${ingredient.name}`}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-track text-xs text-ink-3"
          >
            ✎
          </button>
        </span>
      </div>
    )
  }

  const matchingRecipes = recipes.filter((r) => matchesSearch(r.name, addLogQuery))
  const matchingIngredients = ingredients.filter((i) => matchesSearch(i.name, addLogQuery))

  // --- Recipe builder ---

  function openNewRecipe() {
    setEditingRecipe(null)
    setRecipeName('')
    setRecipeServings('1')
    setRecipeMealType(null)
    setRecipeRows([])
    setImportedNutrition(null)
    setRecipeBuilderOpen(true)
  }

  function openEditRecipe(recipe: Recipe) {
    const lines = (recipeLines.get(recipe.id) ?? []).slice().sort((a, b) => a.position - b.position)
    setEditingRecipe(recipe)
    setRecipeName(recipe.name)
    setRecipeServings(String(recipe.servings))
    setRecipeMealType(recipe.meal_type)
    setRecipeRows(
      lines.map((l) => ({
        ingredientId: l.ingredient_id,
        name: ingredientsById.get(l.ingredient_id)?.name ?? 'Unknown ingredient',
        grams: String(l.grams),
      })),
    )
    setImportedNutrition(null)
    setRecipeBuilderOpen(true)
  }

  // `rawUrl` comes from a saved link's Import button; without one this reads the sheet's
  // input. Both paths end the same way: the builder opens prefilled and the link is
  // remembered in the Links tab.
  async function runImport(rawUrl?: string) {
    const url = (rawUrl ?? importUrl).trim()
    if (!url) return
    setImporting(true)
    setImportError(null)
    const { data, error } = await supabase.functions.invoke<ImportedRecipe>('import-recipe', { body: { url } })
    setImporting(false)

    if (error || !data) {
      // The function puts a readable sentence in the body for the cases worth explaining
      // (unreachable page, no recipe markup); anything else gets a generic line.
      let message = "Couldn't import that link."
      const context = (error as { context?: Response })?.context
      if (context && typeof context.json === 'function') {
        try {
          const body = await context.json()
          if (typeof body?.error === 'string') message = body.error
        } catch {
          /* fall through to the generic message */
        }
      }
      setImportError(message)
      setImportingLinkId(null)
      return
    }

    const resolved = resolveImportedLines(data.ingredientLines, ingredients)
    setEditingRecipe(null)
    setRecipeName(data.name)
    setRecipeServings(data.servings != null ? String(data.servings) : '1')
    setRecipeMealType(null)
    setRecipeRows(
      resolved.map((line) => ({
        ingredientId: line.match?.id ?? '',
        name: line.match?.name ?? '',
        grams: line.grams != null ? String(Math.round(line.grams)) : '',
        importedFrom: line.raw,
        suggestions: line.suggestions.map((i) => ({ id: i.id, name: i.name })),
      })),
    )
    setImportedNutrition(data.statedNutrition)
    setImportOpen(false)
    setImportUrl('')
    setImportingLinkId(null)
    setRecipeBuilderOpen(true)
    rememberLink(url, data.name)
  }

  // Every successful import also lands in the Links tab, so the list builds itself without
  // anything extra to remember. A link that's already there is touched, not duplicated.
  async function rememberLink(rawUrl: string, name: string | null) {
    const normalized = normalizeUrl(rawUrl)
    if (!normalized) return
    const now = new Date().toISOString()

    const existing = links.find((l) => l.url_key === normalized.key)
    if (existing) {
      // Only fill a missing title — a name typed by hand outranks the site's own.
      const patch = { last_imported_at: now, title: existing.title ?? name }
      const { data } = await supabase.from('saved_links').update(patch).eq('id', existing.id).select().maybeSingle()
      if (data) setLinks((prev) => prev.map((l) => (l.id === data.id ? data : l)))
      return
    }

    const row = {
      url: normalized.url,
      url_key: normalized.key,
      title: name || null,
      last_imported_at: now,
    }
    // onConflict rather than a plain insert: `links` can be stale (imported from the sheet
    // in another tab/session), and the constraint would otherwise turn a successful import
    // into a visible error for something the user never asked for.
    const { data } = await supabase
      .from('saved_links')
      .upsert(row, { onConflict: 'user_id,url_key' })
      .select()
      .maybeSingle()
    if (data) setLinks((prev) => [data, ...prev.filter((l) => l.id !== data.id)])
  }

  async function saveLink(e: React.FormEvent) {
    e.preventDefault()
    const normalized = normalizeUrl(linkUrl)
    if (!normalized) {
      setLinkError("That doesn't look like a web link — it needs to be an http(s) address.")
      return
    }
    const existing = links.find((l) => l.url_key === normalized.key)
    if (existing) {
      setLinkError(
        `Already saved as "${linkLabel(existing)}" on ${format(new Date(existing.created_at), 'd MMM')}.`,
      )
      return
    }

    setSavingLink(true)
    setLinkError(null)
    const { data, error } = await supabase
      .from('saved_links')
      .insert({
        url: normalized.url,
        url_key: normalized.key,
        // Left null when unnamed, so the row falls back to the URL's own slug AND an import
        // can still fill in the recipe's real name later. A name typed here outranks both.
        title: linkTitle.trim() || null,
      })
      .select()
      .single()
    setSavingLink(false)

    if (error) {
      // 23505 = the unique (user_id, url_key) constraint, i.e. the row exists but wasn't in
      // the copy this page loaded.
      setLinkError(error.code === '23505' ? 'That link is already saved.' : "Couldn't save that link.")
      return
    }
    setLinks((prev) => [data, ...prev])
    setLinkUrl('')
    setLinkTitle('')
  }

  async function deleteLink(link: SavedLink) {
    setConfirmDeleteLink(null)
    setLinks((prev) => prev.filter((l) => l.id !== link.id))
    await supabase.from('saved_links').delete().eq('id', link.id)
  }

  function addIngredientToRecipe(ingredient: Ingredient) {
    if (pickingIngredientFor === 'new' || pickingIngredientFor === null) {
      const defaultGrams = ingredient.portion_grams != null ? String(ingredient.portion_grams) : '100'
      setRecipeRows((rows) => [...rows, { ingredientId: ingredient.id, name: ingredient.name, grams: defaultGrams }])
    } else {
      setRecipeRows((rows) =>
        rows.map((r, i) =>
          i === pickingIngredientFor
            ? {
                ...r,
                ingredientId: ingredient.id,
                name: ingredient.name,
                // An imported row often arrives with no grams (a volume or count unit we
                // couldn't convert). Once it has an ingredient, its portion is the best
                // starting point available.
                grams: r.grams || (ingredient.portion_grams != null ? String(ingredient.portion_grams) : ''),
              }
            : r,
        ),
      )
    }
    setPickingIngredientFor(null)
    setIngredientPickQuery('')
  }

  async function saveRecipe(e: React.FormEvent) {
    e.preventDefault()
    const name = recipeName.trim()
    const servings = Number(recipeServings) || 1
    const validRows = recipeRows.filter((r) => r.ingredientId && Number(r.grams) > 0)
    if (!name || validRows.length === 0) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    let recipeId: string
    if (editingRecipe) {
      await supabase.from('recipes').update({ name, servings, meal_type: recipeMealType }).eq('id', editingRecipe.id)
      await supabase.from('recipe_ingredients').delete().eq('recipe_id', editingRecipe.id)
      recipeId = editingRecipe.id
    } else {
      const { data, error } = await supabase
        .from('recipes')
        .insert({ name, servings, meal_type: recipeMealType, user_id: user.id })
        .select()
        .single()
      if (error || !data) return
      recipeId = data.id
    }

    await supabase.from('recipe_ingredients').insert(
      validRows.map((r, i) => ({
        recipe_id: recipeId,
        ingredient_id: r.ingredientId,
        grams: Number(r.grams),
        position: i,
        user_id: user.id,
      })),
    )

    setRecipeBuilderOpen(false)
    setEditingRecipe(null)
    load()
  }

  async function deleteRecipe(recipe: Recipe) {
    setRecipes((rs) => rs.filter((r) => r.id !== recipe.id))
    await supabase.from('recipes').delete().eq('id', recipe.id)
  }

  // --- Ingredient library ---

  function openNewIngredient(origin: 'library' | 'recipe' = 'library') {
    setEditingIngredient(null)
    setIngredientForm(emptyIngredientForm())
    setIngredientFormMode('manual')
    setLsvQuery('')
    setLsvResults([])
    setScanLookupError(null)
    setScanLookingUp(false)
    setIngredientFormOrigin(origin)
    setIngredientFormOpen(true)
  }

  function openEditIngredient(ingredient: Ingredient) {
    setEditingIngredient(ingredient)
    setIngredientForm({
      name: ingredient.name,
      kcal: String(ingredient.kcal_per_100g),
      protein: String(ingredient.protein_per_100g),
      carbs: String(ingredient.carbs_per_100g),
      fat: String(ingredient.fat_per_100g),
      fiber: String(ingredient.fiber_per_100g),
      portionLabel: ingredient.portion_label ?? '',
      portionGrams: ingredient.portion_grams != null ? String(ingredient.portion_grams) : '',
      category: ingredient.category ?? '',
    })
    setIngredientFormMode('manual')
    setIngredientFormOrigin('library')
    setIngredientFormOpen(true)
  }

  async function runLsvSearch() {
    const q = lsvQuery.trim()
    if (!q) return
    setLsvSearching(true)
    const results = await searchLivsmedelsverket(q)
    setLsvResults(results)
    setLsvSearching(false)
  }

  async function importLsvFood(food: LivsmedelsverketFood) {
    const macros = await fetchLivsmedelsverketMacros(food.nummer)
    if (!macros) return
    setIngredientForm((f) => ({
      ...f,
      name: food.namn,
      kcal: String(round(macros.kcal, 1)),
      protein: String(round(macros.protein, 1)),
      carbs: String(round(macros.carbs, 1)),
      fat: String(round(macros.fat, 1)),
      fiber: String(round(macros.fiber, 1)),
    }))
    setIngredientFormMode('manual')
  }

  async function handleBarcodeDetected(barcode: string) {
    setScannerOpen(false)
    setScanLookupError(null)
    setScanLookingUp(true)
    let product
    try {
      product = await fetchOpenFoodFactsProduct(barcode)
    } catch {
      // Network/fetch failure — distinct from "we asked Open Food Facts and it doesn't
      // have this barcode" below, so the message doesn't imply the barcode itself is bad.
      setScanLookingUp(false)
      setScanLookupError(`Detected barcode ${barcode}, but couldn't reach Open Food Facts — check your connection and try again.`)
      return
    }
    setScanLookingUp(false)
    if (!product) {
      setScanLookupError(`Detected barcode ${barcode}, but couldn't find it on Open Food Facts — try manual entry instead.`)
      return
    }
    setIngredientForm((f) => ({
      ...f,
      name: product.name,
      kcal: String(round(product.macros.kcal, 1)),
      protein: String(round(product.macros.protein, 1)),
      carbs: String(round(product.macros.carbs, 1)),
      fat: String(round(product.macros.fat, 1)),
      fiber: String(round(product.macros.fiber, 1)),
    }))
    setIngredientFormMode('manual')
  }

  function saveIngredientForm(e: React.FormEvent) {
    e.preventDefault()
    const name = ingredientForm.name.trim()
    if (!name) return
    // Warn (don't block — a legitimate reason to have two same-named entries is rare
    // but not impossible) if another ingredient already has this exact name, so
    // duplicates like the ones just cleaned up don't quietly pile back up.
    const isDuplicate = ingredients.some(
      (i) => i.id !== editingIngredient?.id && i.name.trim().toLowerCase() === name.toLowerCase(),
    )
    if (isDuplicate) {
      setConfirmDuplicateName(name)
    } else {
      saveIngredientNow()
    }
  }

  async function saveIngredientNow() {
    setConfirmDuplicateName(null)
    const name = ingredientForm.name.trim()
    const kcal = Number(ingredientForm.kcal)
    if (!name || Number.isNaN(kcal)) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    // Both halves of the portion shortcut are required together, or neither — a label
    // with no gram equivalent (or vice versa) isn't usable, so treat a partial entry as
    // "no portion set" rather than saving something unusable.
    const portionLabel = ingredientForm.portionLabel.trim()
    const portionGrams = Number(ingredientForm.portionGrams)
    const hasPortion = portionLabel !== '' && !Number.isNaN(portionGrams) && portionGrams > 0
    const payload = {
      name,
      kcal_per_100g: kcal,
      protein_per_100g: Number(ingredientForm.protein) || 0,
      carbs_per_100g: Number(ingredientForm.carbs) || 0,
      fat_per_100g: Number(ingredientForm.fat) || 0,
      fiber_per_100g: Number(ingredientForm.fiber) || 0,
      portion_label: hasPortion ? portionLabel : null,
      portion_grams: hasPortion ? portionGrams : null,
      category: ingredientForm.category.trim() || null,
    }

    if (editingIngredient) {
      await supabase.from('ingredients').update(payload).eq('id', editingIngredient.id)
    } else if (ingredientFormOrigin === 'recipe') {
      // Created from inside the recipe builder's ingredient picker (e.g. scanned a
      // barcode for something new mid-recipe) — insert and immediately drop it into the
      // pending recipe row instead of just returning to an unchanged picker list.
      const { data, error } = await supabase
        .from('ingredients')
        .insert({ ...payload, source: 'manual', user_id: user.id })
        .select()
        .single()
      if (!error && data) addIngredientToRecipe(data)
    } else {
      await supabase.from('ingredients').insert({ ...payload, source: 'manual', user_id: user.id })
    }

    setIngredientFormOpen(false)
    setIngredientFormOrigin('library')
    setEditingIngredient(null)
    load()
  }

  async function deleteIngredient(ingredient: Ingredient) {
    setIngredients((is) => is.filter((i) => i.id !== ingredient.id))
    await supabase.from('ingredients').delete().eq('id', ingredient.id)
  }

  return (
    <Screen
      title={openCategory ? (openCategory === UNCATEGORIZED ? 'Uncategorised' : openCategory) : 'Food'}
      subtitle={
        openCategory
          ? `${(ingredientGroups.get(openCategory) ?? []).length} ingredients · sorted ${CATEGORY_SORT_SUBTITLE[categorySort]}`
          : undefined
      }
      onBack={openCategory ? () => setOpenCategory(null) : undefined}
      onRefresh={load}
      hero={
        openCategory ? (
          <>
            <HeroSearch
              value={categorySearch}
              onChange={setCategorySearch}
              placeholder={`Search in ${openCategory === UNCATEGORIZED ? 'Uncategorised' : openCategory}`}
            />
            <div className="mt-3">
              <ChipRail
                tone="hero"
                options={(Object.keys(CATEGORY_SORT_LABELS) as CategorySort[]).map((s) => ({
                  id: s,
                  label: CATEGORY_SORT_LABELS[s],
                }))}
                value={categorySort}
                onChange={setCategorySort}
              />
            </div>
          </>
        ) : (
          <>
            <HeroSegments
              options={SUB_TABS.map((t) => ({ id: t, label: SUB_TAB_LABELS[t] }))}
              value={subTab}
              onChange={setSubTab}
            />
            {subTab === 'recipes' && (
              <HeroSearch
                value={recipeSearchQuery}
                onChange={setRecipeSearchQuery}
                placeholder={`Search ${recipes.length} recipe${recipes.length === 1 ? '' : 's'}`}
              />
            )}
            {subTab === 'library' && (
              <HeroSearch
                value={librarySearchQuery}
                onChange={setLibrarySearchQuery}
                placeholder={`Search ${ingredients.length} ingredient${ingredients.length === 1 ? '' : 's'}`}
              />
            )}
            {subTab === 'links' && links.length > 0 && (
              <HeroSearch
                value={linkSearchQuery}
                onChange={setLinkSearchQuery}
                placeholder={`Search ${links.length} link${links.length === 1 ? '' : 's'}`}
              />
            )}
            {subTab === 'log' && (
            <>
              <div className="mt-4 flex items-end justify-between gap-3">
                <p className="flex items-baseline gap-[7px] leading-none">
                  <span className="text-[27px] font-semibold">{round(dayTotal.kcal).toLocaleString()}</span>
                  <span className="text-xs font-medium text-white/75">kcal logged</span>
                </p>
                {kcalLeft != null && (
                  <span
                    className="rounded-full px-[11px] py-[5px] text-xs font-semibold"
                    style={
                      kcalLeft >= 0
                        ? { background: CAT.emerald.tint, color: CAT.emerald.ink }
                        : { background: CAT.rose.tint, color: CAT.rose.ink }
                    }
                  >
                    {kcalLeft >= 0 ? `${round(kcalLeft).toLocaleString()} left` : `${round(-kcalLeft).toLocaleString()} over`}
                  </span>
                )}
              </div>
              {macroGrams > 0 && (
                <div className="mt-2.5 flex gap-1">
                  <span className="h-1.5 rounded-full" style={{ flex: dayTotal.protein, background: '#a8cfc0' }} />
                  <span className="h-1.5 rounded-full" style={{ flex: dayTotal.carbs, background: '#e0cf9a' }} />
                  <span className="h-1.5 rounded-full" style={{ flex: dayTotal.fat, background: '#e6b39f' }} />
                </div>
              )}
              <div className="mt-3.5 flex items-center justify-between gap-2 rounded-2xl bg-white/14 px-3 py-[7px]">
                <button
                  onClick={() => setLogDate((d) => format(subDays(new Date(d + 'T00:00:00'), 1), 'yyyy-MM-dd'))}
                  aria-label="Previous day"
                  className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-white/18 text-white"
                >
                  ‹
                </button>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-xs font-medium text-white">
                    {logDate === todayISO() ? 'Today' : format(new Date(logDate + 'T00:00:00'), 'EEE d MMMM')}
                  </span>
                  {logDate !== todayISO() && (
                    <button
                      onClick={() => setLogDate(todayISO())}
                      className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-pine"
                    >
                      Today
                    </button>
                  )}
                </span>
                <button
                  onClick={() => setLogDate((d) => format(addDays(new Date(d + 'T00:00:00'), 1), 'yyyy-MM-dd'))}
                  aria-label="Next day"
                  className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-white/18 text-white"
                >
                  ›
                </button>
              </div>
            </>
          )}
          </>
        )
      }
    >
      {subTab === 'log' && (
        <>
          {/* The meal strip: the day at a glance, and the only meal selector. Tapping an
              unselected tile focuses that meal; tapping the selected one toggles its
              entries open — two stages on one control, so the strip doubles as the list. */}
          <div className="grid shrink-0 grid-cols-4 gap-2">
            {MEAL_TYPES.map((meal) => {
              const look = MEAL_LOOK[meal]
              const kcal = mealKcal.get(meal) ?? null
              const selected = selectedMeal === meal
              const open = expandedMeal === meal
              return (
                <button
                  key={meal}
                  onClick={() => {
                    if (selected) {
                      setExpandedMeal(open ? null : meal)
                    } else {
                      setSelectedMeal(meal)
                      setExpandedMeal(null)
                    }
                  }}
                  aria-label={`${MEAL_TYPE_INFO[meal].label}${selected ? (open ? ' — hide entries' : ' — show entries') : ''}`}
                  className={`flex flex-col items-center gap-[3px] rounded-[18px] px-1 py-2.5 ${
                    selected ? '' : 'border border-line bg-surface'
                  }`}
                  style={selected ? { background: look.accent, boxShadow: `0 4px 12px ${look.accent}4d` } : undefined}
                >
                  <span className="text-[15px] leading-none">{look.icon}</span>
                  <span
                    className="text-[13px] font-semibold leading-none"
                    style={{ color: selected ? '#fff' : kcal == null ? '#a09a8c' : look.ink }}
                  >
                    {kcal == null ? '—' : round(kcal).toLocaleString()}
                  </span>
                  <span
                    className={`text-[9px] leading-none ${selected ? 'font-semibold' : 'font-medium text-ink-muted'}`}
                    style={selected ? { color: 'rgba(255,255,255,.85)' } : undefined}
                  >
                    {MEAL_TYPE_INFO[meal].label}
                  </span>
                  {selected && (
                    <span className="text-[9px] leading-none" style={{ color: 'rgba(255,255,255,.7)' }}>
                      {open ? '⌃' : '⌄'}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {loading ? (
            <p className="text-sm text-ink-disabled">Loading…</p>
          ) : expandedMeal ? (
            <>
              {/* Entries for the open meal, in place of the usuals. */}
              <div className="shrink-0 overflow-hidden rounded-[22px] border border-line bg-surface shadow-card">
                <div
                  className="flex items-center justify-between gap-2.5 px-3.5 py-2.5"
                  style={{ background: MEAL_LOOK[expandedMeal].tint }}
                >
                  <span className="text-[13px] font-semibold" style={{ color: MEAL_LOOK[expandedMeal].ink }}>
                    {MEAL_LOOK[expandedMeal].icon} Logged for {MEAL_TYPE_INFO[expandedMeal].label.toLowerCase()}
                  </span>
                  <span className="shrink-0 text-xs font-semibold" style={{ color: MEAL_LOOK[expandedMeal].ink }}>
                    {round(mealKcal.get(expandedMeal) ?? 0).toLocaleString()} kcal
                  </span>
                </div>
                <div className="flex flex-col gap-[9px] px-3.5 pb-3 pt-2.5">
                  {(dayEntriesByMeal.get(expandedMeal) ?? []).length === 0 ? (
                    <p className="text-[13px] text-ink-disabled">Nothing logged for this meal yet.</p>
                  ) : (
                    (dayEntriesByMeal.get(expandedMeal) ?? []).map((entry) => {
                      const m = macrosFor(entry)
                      return (
                        <div key={entry.id} className="flex items-center gap-2.5">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-ink-2">{entryLabel(entry)}</span>
                            <span className="block text-[10px] font-medium text-ink-muted">
                              {round(m.kcal)} kcal · P {round(m.protein)} C {round(m.carbs)} F {round(m.fat)}
                            </span>
                          </span>
                          <button onClick={() => beginEditEntry(entry)} className="shrink-0 text-[13px] text-ink-faint" aria-label="Edit entry">
                            ✎
                          </button>
                          <button
                            onClick={() => setConfirmDeleteEntry(entry)}
                            className="shrink-0 text-[13px] text-ink-faint"
                            aria-label="Remove entry"
                          >
                            ✕
                          </button>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* The usuals, collapsed into one row that reopens them. */}
              <button
                onClick={() => setExpandedMeal(null)}
                className="flex shrink-0 items-center gap-3 rounded-[20px] border border-line bg-surface px-[15px] py-3 text-left shadow-card"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[13px] text-lg font-semibold"
                  style={{ background: MEAL_LOOK[selectedMeal].tint, color: MEAL_LOOK[selectedMeal].ink }}
                >
                  +
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">
                    Add to {MEAL_TYPE_INFO[selectedMeal].label.toLowerCase()}
                  </span>
                  <span className="mt-0.5 block text-[10px] font-medium text-ink-muted">
                    {usuals.recent.length} recent · {usuals.frequent.length} usual{usuals.frequent.length === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="shrink-0 text-sm text-ink-faint">⌄</span>
              </button>
            </>
          ) : (
            <>
              {usuals.recent.length > 0 && (
                <>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <span className="text-[10px] font-semibold tracking-[0.07em] text-ink-muted">
                      RECENT {MEAL_TYPE_INFO[selectedMeal].label.toUpperCase()}S
                    </span>
                    <span className="h-px flex-1 bg-line-strong" />
                  </div>
                  <div className="no-scrollbar -mt-1 flex shrink-0 gap-[7px] overflow-x-auto">
                    {usuals.recent.map((usual, i) => {
                      const look = MEAL_LOOK[selectedMeal]
                      const first = i === 0
                      return (
                        <button
                          key={`${usual.ref.kind}:${usual.ref.id}`}
                          onClick={() => beginQuantify(usual.ref.kind, usual.ref.id, usual.name, usual.quantity)}
                          className={`flex shrink-0 items-center gap-2 rounded-2xl py-[7px] pl-[11px] pr-[9px] text-left ${
                            first ? '' : 'border border-line bg-surface'
                          }`}
                          style={first ? { background: look.tint } : undefined}
                        >
                          <span className="flex flex-col">
                            <span
                              className="text-xs font-semibold"
                              style={{ color: first ? look.ink : undefined }}
                            >
                              {usual.name}
                            </span>
                            <span className="text-[9px] font-medium" style={{ color: first ? look.accent : '#8b8577' }}>
                              {relativeDayLabel(usual.lastDate, logDate)} · {round(usual.kcal)} kcal
                            </span>
                          </span>
                          <span
                            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                            style={
                              first
                                ? { background: look.accent, color: '#fff' }
                                : { background: look.tint, color: look.ink }
                            }
                          >
                            +
                          </span>
                        </button>
                      )
                    })}
                    <button
                      onClick={openAddLog}
                      aria-label="Search all food"
                      className="flex shrink-0 items-center rounded-2xl border border-line bg-surface px-[11px] py-[7px] text-xs font-medium text-ink-3"
                    >
                      ›
                    </button>
                  </div>
                </>
              )}

              <div className="flex shrink-0 flex-col gap-[9px]">
                <div className="flex items-center gap-2.5">
                  <span className="text-[10px] font-semibold tracking-[0.07em] text-ink-muted">
                    MOST-LOGGED {MEAL_TYPE_INFO[selectedMeal].label.toUpperCase()}S
                  </span>
                  <span className="h-px flex-1 bg-line-strong" />
                </div>
                <div className="grid grid-cols-2 gap-[9px]">
                  {usuals.frequent.map((usual) => {
                    const look = MEAL_LOOK[selectedMeal]
                    const amount =
                      usual.ref.kind === 'recipe'
                        ? `${usual.quantity} serving${usual.quantity === 1 ? '' : 's'}`
                        : `${round(usual.quantity)} g`
                    return (
                      <button
                        key={`${usual.ref.kind}:${usual.ref.id}`}
                        onClick={() => beginQuantify(usual.ref.kind, usual.ref.id, usual.name, usual.quantity)}
                        className="flex flex-col gap-1 rounded-[18px] border border-line bg-surface px-[13px] py-[11px] text-left shadow-card"
                      >
                        <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-ink">{usual.name}</span>
                        <span className="text-[10px] font-medium text-ink-muted">
                          {amount} · {round(usual.kcal)} kcal
                        </span>
                        <span className="mt-0.5 flex items-center justify-between">
                          <span className="text-[9px] font-semibold" style={{ color: look.accent }}>
                            {usual.count}×
                          </span>
                          <span
                            className="flex h-7 w-7 items-center justify-center rounded-full text-[15px] font-semibold"
                            style={{ background: look.tint, color: look.ink }}
                          >
                            +
                          </span>
                        </span>
                      </button>
                    )
                  })}

                  {/* Search and the scanner live in the grid's last cell — no separate
                      action row, which is what keeps the six tiles above the fold. */}
                  <div className="flex flex-col justify-center gap-[5px] rounded-[18px] border border-dashed border-line-strong bg-surface px-[13px] py-[11px]">
                    <button onClick={openAddLog} className="text-left text-[13px] font-semibold text-pine">
                      🔍 Search all
                    </button>
                    <span className="text-[10px] font-medium text-ink-muted">
                      {recipes.length} recipe{recipes.length === 1 ? '' : 's'} · {ingredients.length} item
                      {ingredients.length === 1 ? '' : 's'}
                    </span>
                    <button
                      onClick={() => {
                        setScanLookupError(null)
                        openNewIngredient('library')
                        setScannerOpen(true)
                      }}
                      className="mt-0.5 text-left text-[10px] font-semibold text-pine"
                    >
                      📷 Scan barcode
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Anything logged before meal tagging existed. Kept visible rather than being
              silently dropped from a screen that is now organised entirely by meal. */}
          {!loading && untaggedEntries.length > 0 && (
            <div className="shrink-0 overflow-hidden rounded-[20px] border border-line bg-surface shadow-card">
              <div className="flex items-center justify-between gap-2 bg-track px-3.5 py-2">
                <span className="text-[13px] font-semibold text-ink-3">Not tagged to a meal</span>
                <span className="shrink-0 text-xs font-semibold text-ink-3">
                  {round(untaggedEntries.reduce((sum, e) => sum + macrosFor(e).kcal, 0))} kcal
                </span>
              </div>
              <div className="flex flex-col gap-[9px] px-3.5 pb-3 pt-2.5">
                {untaggedEntries.map((entry) => {
                  const m = macrosFor(entry)
                  return (
                    <div key={entry.id} className="flex items-center gap-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink-2">{entryLabel(entry)}</span>
                        <span className="block text-[10px] font-medium text-ink-muted">{round(m.kcal)} kcal</span>
                      </span>
                      <button onClick={() => beginEditEntry(entry)} className="shrink-0 text-[13px] text-ink-faint" aria-label="Edit entry">
                        ✎
                      </button>
                      <button
                        onClick={() => setConfirmDeleteEntry(entry)}
                        className="shrink-0 text-[13px] text-ink-faint"
                        aria-label="Remove entry"
                      >
                        ✕
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {subTab === 'recipes' && (
        <>
          <div className="flex gap-2.5">
            <button
              onClick={() => {
                setImportUrl('')
                setImportError(null)
                setImportOpen(true)
              }}
              className="flex-1 rounded-[20px] bg-pine py-3.5 text-sm font-semibold text-white"
            >
              🔗 Import from URL
            </button>
            <button
              onClick={openNewRecipe}
              className="flex-1 rounded-[20px] border border-line-strong bg-surface py-3.5 text-sm font-semibold text-pine"
            >
              + New recipe
            </button>
          </div>

          <ChipRail
            options={[
              { id: 'all' as const, label: `All ${recipes.length}` },
              ...MEAL_TYPES.map((m) => ({ id: m, label: `${MEAL_TYPE_INFO[m].icon} ${recipeMealCounts.get(m) ?? 0}` })),
            ]}
            value={mealTypeFilter}
            onChange={setMealTypeFilter}
          />

          <div className="flex items-center justify-between gap-2">
            <span className="shrink-0 text-xs font-semibold text-ink-3">Sorted by</span>
            <select
              value={recipeSort}
              onChange={(e) => setRecipeSort(e.target.value as RecipeSort)}
              aria-label="Sort recipes"
              className="min-w-0 rounded-[14px] border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 outline-none"
            >
              {(Object.keys(RECIPE_SORT_LABELS) as RecipeSort[]).map((s) => (
                <option key={s} value={s}>
                  {RECIPE_SORT_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <p className="text-sm text-ink-disabled">Loading…</p>
          ) : recipes.length === 0 ? (
            <p className="text-sm text-ink-disabled">No recipes yet — add one below.</p>
          ) : sortedRecipes.length === 0 ? (
            <p className="text-sm text-ink-disabled">
              {recipeSearchQuery ? `No recipes match "${recipeSearchQuery}".` : 'No recipes tagged for that meal.'}
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {sortedRecipes.map((recipe) => {
                const lines = recipeLines.get(recipe.id) ?? []
                const perServing = recipeMacros(recipe)
                const logged = counts.byRecipe.get(recipe.id) ?? 0
                // MEAL_LOOK, not a second map: this card used to paint dinner slate blue
                // while the Log tab painted it terracotta, for the same meal.
                const accent = recipe.meal_type ? MEAL_LOOK[recipe.meal_type].accent : '#8b8577'
                return (
                  <div
                    key={recipe.id}
                    className="flex overflow-hidden rounded-[22px] border border-line bg-surface shadow-card"
                  >
                    <span className="w-[5px] shrink-0 self-stretch" style={{ background: accent }} />
                    <div className="min-w-0 flex-1 px-4 py-3.5">
                      <button onClick={() => setViewingRecipe(recipe)} className="w-full text-left">
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-[15px] font-semibold text-ink">{recipe.name}</p>
                            <p className="mt-0.5 truncate text-[11px] font-medium text-ink-muted">
                              {recipe.meal_type ? `${MEAL_TYPE_INFO[recipe.meal_type].icon} ${MEAL_TYPE_INFO[recipe.meal_type].label} · ` : ''}
                              {recipe.servings} serving{recipe.servings === 1 ? '' : 's'} · {lines.length} ingredient
                              {lines.length === 1 ? '' : 's'}
                            </p>
                          </div>
                          <span className="shrink-0 text-right">
                            <span className="block text-[17px] font-semibold text-ink">{round(perServing.kcal)}</span>
                            <span className="text-[10px] font-medium text-ink-muted">kcal/serving</span>
                          </span>
                        </div>
                        <MacroSplitBar macros={perServing} height={6} />
                      </button>
                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-[11px] font-medium text-ink-2">
                          P {round(perServing.protein)}g · C {round(perServing.carbs)}g · F {round(perServing.fat)}g
                          {logged > 0 && ` · logged ${logged}×`}
                        </span>
                        <span className="flex shrink-0 gap-1.5">
                          <button
                            onClick={() => logFromList('recipe', recipe.id, recipe.name)}
                            className="rounded-[14px] bg-cat-emerald-tint px-3 py-1.5 text-xs font-semibold text-cat-emerald-ink"
                          >
                            + Log
                          </button>
                          <button
                            onClick={() => openEditRecipe(recipe)}
                            aria-label={`Edit ${recipe.name}`}
                            className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-track text-xs text-ink-3"
                          >
                            ✎
                          </button>
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Library, collapsed: one row per category. A text search bypasses the accordion
          entirely and shows flat results, which is what a search is for. */}
      {subTab === 'library' && !openCategory && (
        <>
          <div className="flex gap-2.5">
            <button
              onClick={() => {
                setScanLookupError(null)
                openNewIngredient('library')
                setScannerOpen(true)
              }}
              className="flex flex-1 items-center justify-center gap-2 rounded-[20px] bg-pine py-3.5 text-sm font-semibold text-white"
            >
              📷 Scan
            </button>
            <button
              onClick={() => openNewIngredient('library')}
              className="flex-1 rounded-[20px] border border-line-strong bg-surface py-3.5 text-sm font-semibold text-pine"
            >
              + New
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-ink-disabled">Loading…</p>
          ) : ingredients.length === 0 ? (
            <p className="text-sm text-ink-disabled">No ingredients yet — add one above.</p>
          ) : librarySearchQuery ? (
            (() => {
              const matches = ingredients.filter((i) => matchesSearch(i.name, librarySearchQuery))
              if (matches.length === 0)
                return <p className="text-sm text-ink-disabled">No ingredients match "{librarySearchQuery}".</p>
              return (
                <div className="flex flex-col gap-2">
                  {matches.map((ingredient) => renderIngredientRow(ingredient, true))}
                </div>
              )
            })()
          ) : (
            <>
              {recentIngredients.length > 0 && (
                <>
                  <p className="text-xs font-semibold text-ink-3">Recently used</p>
                  <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
                    {recentIngredients.map((ingredient) => (
                      <button
                        key={ingredient.id}
                        onClick={() => logFromList('ingredient', ingredient.id, ingredient.name)}
                        className="shrink-0 whitespace-nowrap rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-xs font-medium text-ink"
                      >
                        {ingredient.name}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="flex flex-col gap-2">
                {categoryKeys.map((key) => {
                  const group = ingredientGroups.get(key)!
                  const look = categoryLook(key)
                  const usedCount = group.filter((i) => usedThisWeek.has(i.id)).length
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        setOpenCategory(key)
                        setCategorySearch('')
                        setCategorySort('az')
                      }}
                      className="flex items-center gap-3 rounded-[20px] border border-line bg-surface px-4 py-3.5 text-left shadow-card"
                    >
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[15px]"
                        style={{ background: look.tint }}
                      >
                        {look.glyph}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">
                          {key === UNCATEGORIZED ? 'Uncategorised' : key}
                        </span>
                        <span className="block truncate text-[11px] text-ink-muted">
                          {group.length} item{group.length === 1 ? '' : 's'}
                          {key === UNCATEGORIZED
                            ? ' · tap to sort them'
                            : usedCount > 0
                              ? ` · ${usedCount} used this week`
                              : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm text-ink-muted">⌄</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <p className="text-[11px] text-ink-disabled">Nutrition data via Livsmedelsverket's Livsmedelsdatabasen (CC BY 4.0).</p>
        </>
      )}

      {/* Library, one category open — a pushed view with its own header (see Screen's
          onBack) and its own sort rail. */}
      {subTab === 'library' && openCategory && (
        <>
          {openCategoryIngredients.length === 0 ? (
            <p className="text-sm text-ink-disabled">
              {categorySearch ? `Nothing in here matches "${categorySearch}".` : 'Nothing in this category yet.'}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {openCategoryIngredients.map((ingredient, i) => {
                // Letter headings only make sense while the list is alphabetical.
                const letter = ingredient.name.charAt(0).toUpperCase()
                const previousLetter = i > 0 ? openCategoryIngredients[i - 1].name.charAt(0).toUpperCase() : null
                return (
                  <div key={ingredient.id}>
                    {categorySort === 'az' && letter !== previousLetter && (
                      <p className={`text-xs font-semibold text-ink-muted ${i > 0 ? 'mt-2.5' : ''} mb-2`}>{letter}</p>
                    )}
                    {renderIngredientRow(ingredient, false)}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Saved links: recipe pages parked for later. The Import button runs the exact same
          path as the Recipes tab's sheet, so a saved link is one tap from a prefilled
          builder. Duplicates can't accumulate here — see saveLink/rememberLink. */}
      {subTab === 'links' && (
        <>
          <form onSubmit={saveLink} className="flex flex-col gap-2 rounded-[22px] border border-line bg-surface p-3.5 shadow-card">
            <input
              value={linkUrl}
              onChange={(e) => {
                setLinkUrl(e.target.value)
                setLinkError(null)
              }}
              // Deliberately not type="url": that makes the browser block the submit with its
              // own message for a scheme-less paste ("ica.se/recept/…"), which normalizeUrl
              // handles fine. Validation belongs to saveLink, which can say something useful.
              type="text"
              inputMode="url"
              placeholder="https://…"
              aria-label="Link to save"
              className="w-full rounded-[18px] border border-line bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
            />
            <div className="flex gap-2">
              <input
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                placeholder="Name (optional)"
                aria-label="Name for this link"
                className="min-w-0 flex-1 rounded-[18px] border border-line bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
              />
              <button
                type="submit"
                disabled={savingLink || !linkUrl.trim()}
                className="shrink-0 rounded-[18px] bg-pine px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {savingLink ? 'Saving…' : 'Save'}
              </button>
            </div>
            {linkError && <p className="text-xs text-cat-rose-ink">{linkError}</p>}
            {!linkError && (
              <p className="text-[11px] text-ink-disabled">
                Left blank, the name is taken from the link — and replaced by the recipe's real name once imported.
              </p>
            )}
          </form>

          {loading ? (
            <p className="text-sm text-ink-disabled">Loading…</p>
          ) : links.length === 0 ? (
            <p className="text-sm text-ink-disabled">
              No saved links yet. Paste one above, or import a recipe from a URL — every import is saved here.
            </p>
          ) : visibleLinks.length === 0 ? (
            <p className="text-sm text-ink-disabled">No links match "{linkSearchQuery}".</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {visibleLinks.map((link) => (
                <div key={link.id} className="rounded-[22px] border border-line bg-surface px-4 py-3.5 shadow-card">
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-ink">{linkLabel(link)}</p>
                      <p className="mt-0.5 truncate text-[11px] font-medium text-ink-muted">
                        🔗 {linkHost(link.url)} · saved {format(new Date(link.created_at), 'd MMM')}
                        {link.last_imported_at && ` · imported ${format(new Date(link.last_imported_at), 'd MMM')}`}
                      </p>
                    </div>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${linkLabel(link)}`}
                      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-track text-xs text-ink-3"
                    >
                      ↗
                    </a>
                  </div>
                  {importingLinkId === link.id && importError && (
                    <p className="mt-2 text-xs text-cat-rose-ink">{importError}</p>
                  )}
                  <div className="mt-2.5 flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => {
                        setImportError(null)
                        setImportingLinkId(link.id)
                        runImport(link.url)
                      }}
                      disabled={importing}
                      className="rounded-[14px] bg-cat-emerald-tint px-3 py-1.5 text-xs font-semibold text-cat-emerald-ink disabled:opacity-50"
                    >
                      {importing && importingLinkId === link.id ? 'Reading…' : 'Import'}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteLink(link)}
                      aria-label={`Remove ${linkLabel(link)}`}
                      className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-track text-xs text-ink-3"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* View recipe — read-only breakdown of which ingredients drive the recipe's
          calories/macros, sorted highest-kcal-first, so a suspiciously high-calorie
          recipe can be traced back to the actual line that's off (wrong grams, wrong
          ingredient) instead of just seeing the wrong total. */}
      {viewingRecipe &&
        (() => {
          const lines = (recipeLines.get(viewingRecipe.id) ?? []).slice().sort((a, b) => a.position - b.position)
          const total = recipeTotalMacros(lines, ingredientsById)
          const perServing = recipePerServingMacros(viewingRecipe, lines, ingredientsById)
          const breakdown = lines
            .map((line) => {
              const ingredient = ingredientsById.get(line.ingredient_id)
              const macros = ingredient ? scaleMacros(ingredientMacros(ingredient), line.grams) : ZERO_MACROS
              return { line, ingredient, macros }
            })
            .sort((a, b) => b.macros.kcal - a.macros.kcal)
          const maxKcal = Math.max(...breakdown.map((r) => r.macros.kcal), 1)
          return (
            <div className="fixed inset-0 z-50 flex flex-col bg-page safe-top safe-bottom">
              <div className="flex items-center justify-between px-4 pt-4">
                <h2 className="text-lg font-bold text-ink">{viewingRecipe.name}</h2>
                <button
                  onClick={() => setViewingRecipe(null)}
                  className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2"
                >
                  Close ✕
                </button>
              </div>
              <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
                <div className="rounded-[20px] border border-line bg-surface px-4 py-3 shadow-card">
                  <p className="text-lg font-bold text-ink">{round(perServing.kcal)} kcal/serving</p>
                  <MacroRow macros={perServing} />
                  <p className="mt-1 text-xs text-ink-disabled">
                    {round(total.kcal)} kcal total · {viewingRecipe.servings} serving{viewingRecipe.servings === 1 ? '' : 's'}
                  </p>
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase text-ink-disabled">Ingredients, by calorie contribution</h3>
                  <div className="flex flex-col gap-2">
                    {breakdown.map(({ line, ingredient, macros }) => (
                      <div key={line.id} className="rounded-[20px] border border-line bg-surface px-4 py-3 shadow-card">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-ink">{ingredient?.name ?? 'Unknown ingredient'}</p>
                          <p className="shrink-0 text-sm font-semibold text-ink">{round(macros.kcal)} kcal</p>
                        </div>
                        <p className="text-[11px] text-ink-disabled">
                          {line.grams}g · P {round(macros.protein)}g C {round(macros.carbs)}g F {round(macros.fat)}g
                        </p>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-track">
                          <div className="h-full rounded-full bg-pine" style={{ width: `${(macros.kcal / maxKcal) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 border-t border-line p-4">
                <button
                  onClick={() => {
                    const recipe = viewingRecipe
                    setViewingRecipe(null)
                    openEditRecipe(recipe)
                  }}
                  className="flex-1 rounded-[20px] bg-pine px-4 py-2.5 font-semibold text-white"
                >
                  Edit recipe
                </button>
              </div>
            </div>
          )
        })()}

      {/* Add to log */}
      {addLogOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-page safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-ink">Add food</h2>
            <button onClick={() => setAddLogOpen(false)} className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2">
              Close ✕
            </button>
          </div>
          <div className="p-4">
            <input
              autoFocus
              value={addLogQuery}
              onChange={(e) => setAddLogQuery(e.target.value)}
              placeholder="Search recipes and ingredients"
              className="w-full rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
            />
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {matchingRecipes.length > 0 && (
              <>
                <h3 className="mb-1 text-xs font-semibold uppercase text-ink-disabled">Recipes</h3>
                <div className="mb-3 flex flex-col gap-2">
                  {matchingRecipes.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => beginQuantify('recipe', r.id, r.name)}
                      className="flex items-center justify-between rounded-[20px] border border-line bg-surface px-4 py-3 text-left shadow-card"
                    >
                      <span className="font-medium text-ink">{r.name}</span>
                      <span className="text-xs text-ink-disabled">
                        {round(recipePerServingMacros(r, recipeLines.get(r.id) ?? [], ingredientsById).kcal)} kcal/serving
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {matchingIngredients.length > 0 && (
              <>
                <h3 className="mb-1 text-xs font-semibold uppercase text-ink-disabled">Ingredients</h3>
                <div className="flex flex-col gap-2">
                  {matchingIngredients.map((i) => (
                    <button
                      key={i.id}
                      onClick={() => beginQuantify('ingredient', i.id, i.name)}
                      className="flex items-center justify-between rounded-[20px] border border-line bg-surface px-4 py-3 text-left shadow-card"
                    >
                      <span className="font-medium text-ink">{i.name}</span>
                      <span className="text-xs text-ink-disabled">{i.kcal_per_100g} kcal/100g</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {matchingRecipes.length === 0 && matchingIngredients.length === 0 && (
              <p className="text-sm text-ink-disabled">No matches — add a new ingredient or recipe from the Recipes/Library tabs first.</p>
            )}
          </div>
        </div>
      )}

      {/* Quantity sheet — presets rather than a keypad, because almost every log is one
          of four amounts. The ⌨ cell is the escape for the rest. */}
      {quantifying &&
        (() => {
          const kind = quantifying.kind
          const look = MEAL_LOOK[quantifyMealType ?? selectedMeal]
          const presets = PRESET_QUANTITIES[kind]
          const labels = PRESET_LABELS[kind]
          const value = Number(quantifyValue)
          const recipe = kind === 'recipe' ? recipesById.get(quantifying.id) : null
          const ingredient = kind === 'ingredient' ? ingredientsById.get(quantifying.id) : null
          const unitMacros = recipe
            ? recipePerServingMacros(recipe, recipeLines.get(recipe.id) ?? [], ingredientsById)
            : ingredient
              ? ingredientMacros(ingredient)
              : ZERO_MACROS
          // scaleMacros treats its argument as GRAMS against per-100g macros. An
          // ingredient's macros are per 100 g, so grams pass straight through; a recipe's
          // are per serving, so servings have to be multiplied up by 100 to cancel the
          // /100 inside. Getting this wrong shows a recipe at a hundredth of its calories.
          const amount = Number.isFinite(value) && value > 0 ? value : 0
          const live = scaleMacros(unitMacros, kind === 'recipe' ? amount * 100 : amount)
          const perUnitKcal = round(unitMacros.kcal)
          const timesLogged =
            (kind === 'recipe' ? counts.byRecipe.get(quantifying.id) : counts.byIngredient.get(quantifying.id)) ?? 0
          const liveGrams = live.protein + live.carbs + live.fat

          return (
            <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => setQuantifying(null)}>
              <div
                className="flex flex-col gap-[15px] rounded-t-[28px] bg-surface px-5 pb-[26px] pt-3 safe-bottom"
                style={{ boxShadow: '0 -12px 32px rgba(35,36,31,.18)' }}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="mx-auto h-1 w-[38px] rounded-full bg-line-strong" />

                <div className="flex items-start gap-3">
                  <span
                    className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[15px] text-lg"
                    style={{ background: look.tint }}
                  >
                    {kind === 'recipe' ? (recipe?.meal_type ? MEAL_LOOK[recipe.meal_type].icon : '🍽') : '🥗'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] font-semibold text-ink">{quantifying.name}</span>
                    <span className="mt-0.5 block text-[11px] font-medium text-ink-muted">
                      {perUnitKcal.toLocaleString()} kcal {kind === 'recipe' ? 'per serving' : 'per 100 g'}
                      {timesLogged > 0 && ` · logged ${timesLogged}×`}
                    </span>
                  </span>
                  {/* Changeable on purpose: a mis-tap on the wrong meal shouldn't mean
                      backing out and starting over. */}
                  <button
                    onClick={() => setMealPickerOpen((v) => !v)}
                    className="shrink-0 rounded-full px-2.5 py-[5px] text-[11px] font-semibold"
                    style={{ background: look.tint, color: look.ink }}
                  >
                    {quantifyMealType ? MEAL_TYPE_INFO[quantifyMealType].label : 'No meal'} ⌄
                  </button>
                </div>

                {mealPickerOpen && (
                  <MealTypePicker
                    value={quantifyMealType}
                    onChange={(v) => {
                      setQuantifyMealType(v)
                      setMealPickerOpen(false)
                    }}
                  />
                )}

                <div className="flex flex-col gap-[9px]">
                  <span className="text-[10px] font-semibold tracking-[0.07em] text-ink-muted">HOW MUCH?</span>
                  <div className="grid grid-cols-5 gap-[7px]">
                    {presets.map((preset, i) => {
                      const active = !quantifyFreeform && value === preset
                      return (
                        <button
                          key={preset}
                          onClick={() => {
                            setQuantifyValue(String(preset))
                            setQuantifyFreeform(false)
                          }}
                          className={`rounded-[15px] py-[11px] text-center text-[13px] font-semibold ${
                            active ? 'text-white' : 'border border-line bg-surface text-ink-2'
                          }`}
                          style={active ? { background: look.accent } : undefined}
                        >
                          {labels[i]}
                        </button>
                      )
                    })}
                    <button
                      onClick={() => setQuantifyFreeform(true)}
                      aria-label="Enter an exact amount"
                      className={`rounded-[15px] border border-dashed py-[11px] text-center text-[11px] font-semibold ${
                        quantifyFreeform ? 'border-pine text-pine' : 'border-line-strong text-ink-3'
                      }`}
                    >
                      ⌨
                    </button>
                  </div>

                  {quantifyFreeform && (
                    <input
                      autoFocus
                      value={quantifyValue}
                      onChange={(e) => setQuantifyValue(e.target.value)}
                      type="number"
                      inputMode="decimal"
                      step={kind === 'recipe' ? '0.5' : '1'}
                      aria-label={kind === 'recipe' ? 'Servings' : 'Grams'}
                      className="w-full rounded-[18px] border border-line-strong bg-surface px-4 py-2.5 text-ink outline-none focus:border-pine"
                    />
                  )}

                  {/* An ingredient with a standard portion keeps its quick-taps — this is
                      how "1 msk = 15 g" reaches the sheet. */}
                  {kind === 'ingredient' && ingredient?.portion_label && ingredient.portion_grams != null && (
                    <div className="flex gap-1.5">
                      {[1, 2, 3].map((n) => (
                        <button
                          key={n}
                          onClick={() => {
                            setQuantifyValue(String(round(ingredient.portion_grams! * n, 1)))
                            setQuantifyFreeform(true)
                          }}
                          className="flex-1 rounded-xl bg-track py-1.5 text-xs font-medium text-ink-2"
                        >
                          {n} {ingredient.portion_label}
                        </button>
                      ))}
                    </div>
                  )}

                  {quantifyLastUsed != null && (
                    <span className="text-[11px] font-medium text-ink-muted">
                      Last time you logged{' '}
                      {kind === 'recipe'
                        ? `${quantifyLastUsed} serving${quantifyLastUsed === 1 ? '' : 's'}`
                        : `${round(quantifyLastUsed)} g`}
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-2 rounded-[18px] bg-track px-3.5 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[19px] font-semibold text-ink">{round(live.kcal).toLocaleString()} kcal</span>
                    <span className="text-[11px] font-medium text-ink-2">
                      P {round(live.protein)} g · C {round(live.carbs)} g · F {round(live.fat)} g
                    </span>
                  </div>
                  {liveGrams > 0 && (
                    <div className="flex gap-1">
                      <span className="h-1.5 rounded-full" style={{ flex: live.protein, background: '#a8cfc0' }} />
                      <span className="h-1.5 rounded-full" style={{ flex: live.carbs, background: '#e0cf9a' }} />
                      <span className="h-1.5 rounded-full" style={{ flex: live.fat, background: '#e6b39f' }} />
                    </div>
                  )}
                </div>

                <div className="flex gap-2.5">
                  <button
                    onClick={() => setQuantifying(null)}
                    className="shrink-0 rounded-[18px] border border-line-strong bg-surface px-5 py-3.5 text-sm font-semibold text-ink-3"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmQuantify}
                    disabled={!(Number(quantifyValue) > 0)}
                    className="flex-1 rounded-[18px] bg-pine py-3.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {quantifying.entryId
                      ? 'Save'
                      : `Log to ${quantifyMealType ? MEAL_TYPE_INFO[quantifyMealType].label.toLowerCase() : 'the day'}`}
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

      {/* Recipe builder */}
      {/* Paste a link; everything after the fetch happens in the recipe builder, so the
          pickers and the new-ingredient form are the ones already in use elsewhere. */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={() => setImportOpen(false)}>
          <div
            className="w-full max-w-xs rounded-3xl border border-line bg-surface p-5 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-semibold text-ink">Import a recipe</p>
            <p className="mt-1 text-sm text-ink-3">
              Paste a recipe link. Ingredients get matched against your library — anything unmatched you'll resolve in the
              builder before saving.
            </p>
            <input
              autoFocus
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !importing) runImport()
              }}
              type="url"
              inputMode="url"
              placeholder="https://…"
              className="mt-3 w-full rounded-[20px] border border-line bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
            />
            {importError && <p className="mt-2 text-xs text-cat-rose-ink">{importError}</p>}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setImportOpen(false)}
                className="flex-1 rounded-[20px] bg-track px-4 py-2.5 font-medium text-ink-2"
              >
                Cancel
              </button>
              <button
                onClick={() => runImport()}
                disabled={importing || !importUrl.trim()}
                className="flex-1 rounded-[20px] bg-pine px-4 py-2.5 font-semibold text-white disabled:opacity-50"
              >
                {importing ? 'Reading…' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {recipeBuilderOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-page safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-ink">{editingRecipe ? 'Edit recipe' : 'New recipe'}</h2>
            <button
              onClick={() => {
                setRecipeBuilderOpen(false)
                setEditingRecipe(null)
              }}
              className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2"
            >
              Close ✕
            </button>
          </div>
          <form onSubmit={saveRecipe} className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
            <input
              autoFocus
              value={recipeName}
              onChange={(e) => setRecipeName(e.target.value)}
              placeholder="Recipe name"
              className="rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
            />
            <div className="flex items-center gap-2">
              <span className="text-sm text-ink-3">Makes</span>
              <input
                value={recipeServings}
                onChange={(e) => setRecipeServings(e.target.value)}
                type="number"
                step="0.5"
                className="w-20 rounded-[20px] border border-line-strong bg-surface px-3 py-2 text-center text-ink outline-none focus:border-pine"
              />
              <span className="text-sm text-ink-3">servings</span>
            </div>

            <div>
              <p className="mb-1 text-xs text-ink-disabled">Meal (optional — used to prefill logging)</p>
              <MealTypePicker value={recipeMealType} onChange={setRecipeMealType} />
            </div>

            {/* What the rows currently add up to. For an imported recipe the site's own
                figure sits beside it — a cross-check on whether the ingredient matching
                came out sane, not something that gets stored. */}
            {(builderPerServing != null || importedNutrition?.kcal != null) && (
              <div className="rounded-[20px] border border-line bg-surface px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-medium text-ink-muted">Computed from these ingredients</span>
                  {builderPerServing && (
                    <span className="text-[17px] font-semibold text-ink">{round(builderPerServing.kcal)} kcal/serving</span>
                  )}
                </div>
                {builderPerServing && <MacroRow macros={builderPerServing} />}
                {importedNutrition?.kcal != null && (
                  <p className="mt-1.5 border-t border-line pt-1.5 text-[11px] text-ink-muted">
                    The site states {round(importedNutrition.kcal)} kcal/serving
                    {builderPerServing && unresolvedRowCount > 0
                      ? ` — ${unresolvedRowCount} line${unresolvedRowCount === 1 ? '' : 's'} still unresolved, so expect a gap.`
                      : builderPerServing && Math.abs(importedNutrition.kcal - builderPerServing.kcal) > importedNutrition.kcal * 0.25
                        ? ' — that is well off what these ingredients add up to; worth checking a match or two.'
                        : '.'}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              {recipeRows.map((row, i) => {
                const portionIngredient = row.ingredientId ? ingredientsById.get(row.ingredientId) : null
                // Read the name off the library rather than the row's copy, so renaming an
                // ingredient mid-recipe shows up here immediately. `row.name` is only a
                // fallback for a row whose ingredient has since been deleted.
                const rowName = row.ingredientId ? (portionIngredient?.name ?? row.name) : ''
                return (
                  <div
                    key={i}
                    className={`flex flex-col gap-2 rounded-[20px] border p-3 ${
                      row.importedFrom && !row.ingredientId ? 'border-cat-amber' : 'border-line'
                    }`}
                  >
                    {/* An imported line keeps its original text: unresolved, it's the only
                        clue what the row should be; resolved, it's how you check the match. */}
                    {row.importedFrom && (
                      <p className="text-[11px] text-ink-muted">
                        {row.ingredientId ? 'From: ' : 'Unmatched: '}
                        <span className={row.ingredientId ? '' : 'font-semibold text-cat-amber-ink'}>{row.importedFrom}</span>
                      </p>
                    )}
                    {/* Offered, never applied — the import deliberately won't guess which
                        of these is right, since a wrong one silently skews the macros. */}
                    {!row.ingredientId && row.suggestions && row.suggestions.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-ink-muted">Did you mean</span>
                        {row.suggestions.map((suggestion) => (
                          <button
                            key={suggestion.id}
                            type="button"
                            onClick={() => {
                              const ingredient = ingredientsById.get(suggestion.id)
                              if (!ingredient) return
                              setRecipeRows((rows) =>
                                rows.map((r, idx) =>
                                  idx === i
                                    ? {
                                        ...r,
                                        ingredientId: ingredient.id,
                                        name: ingredient.name,
                                        grams:
                                          r.grams || (ingredient.portion_grams != null ? String(ingredient.portion_grams) : ''),
                                      }
                                    : r,
                                ),
                              )
                            }}
                            className="rounded-full bg-cat-emerald-tint px-2.5 py-1 text-[11px] font-semibold text-cat-emerald-ink"
                          >
                            {suggestion.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPickingIngredientFor(i)
                          setIngredientPickQuery('')
                        }}
                        className={`min-w-0 flex-1 text-left font-medium ${rowName ? 'text-ink' : 'text-pine'}`}
                      >
                        {rowName || 'Choose ingredient…'}
                      </button>
                      {/* Edit the ingredient itself without leaving the recipe — fix wrong
                          macros, rename it, or give it a portion ("1 klyfta = 5 g"). The
                          form renders at z-[65], above this builder at z-50. */}
                      {portionIngredient && (
                        <button
                          type="button"
                          onClick={() => openEditIngredient(portionIngredient)}
                          className="shrink-0 px-1 text-sm text-ink-faint"
                          aria-label={`Edit ${portionIngredient.name}`}
                        >
                          ✎
                        </button>
                      )}
                      <input
                        value={row.grams}
                        onChange={(e) => setRecipeRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, grams: e.target.value } : r)))}
                        type="number"
                        placeholder="g"
                        className="w-16 min-w-0 rounded-xl border border-line-strong bg-surface px-2 py-2 text-center text-ink outline-none focus:border-pine"
                      />
                      <button
                        type="button"
                        onClick={() => setRecipeRows((rows) => rows.filter((_, idx) => idx !== i))}
                        className="shrink-0 px-1 text-ink-faint"
                        aria-label="Remove ingredient"
                      >
                        ✕
                      </button>
                    </div>
                    {portionIngredient?.portion_label && portionIngredient.portion_grams && (
                      <div className="flex gap-1.5">
                        {[1, 2, 3].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() =>
                              setRecipeRows((rows) =>
                                rows.map((r, idx) =>
                                  idx === i ? { ...r, grams: String(round(portionIngredient.portion_grams! * n, 1)) } : r,
                                ),
                              )
                            }
                            className="flex-1 rounded-xl bg-track py-1 text-xs font-medium text-ink-2"
                          >
                            {n} {portionIngredient.portion_label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <button
              type="button"
              onClick={() => {
                setPickingIngredientFor('new')
                setIngredientPickQuery('')
              }}
              className="rounded-[20px] border border-line-strong bg-surface py-2.5 text-sm font-semibold text-pine"
            >
              + Add ingredient
            </button>
            <button type="submit" className="mt-2 rounded-[20px] bg-pine px-4 py-2.5 font-semibold text-white">
              {editingRecipe ? 'Save changes' : 'Save recipe'}
            </button>
          </form>

          {pickingIngredientFor !== null && (
            <div className="fixed inset-0 z-[60] flex flex-col bg-page safe-top safe-bottom">
              <div className="flex items-center justify-between px-4 pt-4">
                <h2 className="text-lg font-bold text-ink">Choose ingredient</h2>
                <button
                  onClick={() => setPickingIngredientFor(null)}
                  className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2"
                >
                  Close ✕
                </button>
              </div>
              <div className="p-4">
                <input
                  autoFocus
                  value={ingredientPickQuery}
                  onChange={(e) => setIngredientPickQuery(e.target.value)}
                  placeholder="Search ingredient library"
                  className="w-full rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
                />
              </div>
              <div className="px-4 pb-2">
                <button
                  type="button"
                  onClick={() => openNewIngredient('recipe')}
                  className="w-full rounded-[20px] border border-line-strong bg-surface py-2.5 text-sm font-semibold text-pine"
                >
                  + New ingredient (manual, search, or 📷 scan barcode)
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                {(() => {
                  const candidates = ingredients.filter((i) => matchesSearch(i.name, ingredientPickQuery))
                  return (
                    <div className="flex flex-col gap-2">
                      {candidates.length === 0 && <p className="text-sm text-ink-disabled">No matches — add it above.</p>}
                      {candidates.map((ing) => (
                        <button
                          key={ing.id}
                          type="button"
                          onClick={() => addIngredientToRecipe(ing)}
                          className="flex items-center justify-between rounded-[20px] border border-line bg-surface px-4 py-3 text-left shadow-card"
                        >
                          <span className="font-medium text-ink">{ing.name}</span>
                          <span className="text-xs text-ink-disabled">{ing.kcal_per_100g} kcal/100g</span>
                        </button>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ingredient form (manual entry or import from Livsmedelsverket). z-[65]: can be
          opened from inside the recipe builder's ingredient picker (z-[60]), and needs to
          stack above it; the barcode scanner it can open is z-[70], above this in turn. */}
      {ingredientFormOpen && (
        <div className="fixed inset-0 z-[65] flex flex-col bg-page safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-ink">{editingIngredient ? 'Edit ingredient' : 'New ingredient'}</h2>
            <button
              onClick={() => setIngredientFormOpen(false)}
              className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2"
            >
              Close ✕
            </button>
          </div>

          <div className="flex gap-2 px-4 pt-3">
            <div className="flex flex-1 gap-2 rounded-[20px] bg-track p-1">
              <button
                type="button"
                onClick={() => setIngredientFormMode('manual')}
                className={`flex-1 rounded-xl px-2 py-2 text-sm font-medium transition ${
                  ingredientFormMode === 'manual' ? 'bg-surface text-cat-emerald-ink shadow-card' : 'text-ink-3'
                }`}
              >
                Manual entry
              </button>
              <button
                type="button"
                onClick={() => setIngredientFormMode('search')}
                className={`flex-1 rounded-xl px-2 py-2 text-sm font-medium transition ${
                  ingredientFormMode === 'search' ? 'bg-surface text-cat-emerald-ink shadow-card' : 'text-ink-3'
                }`}
              >
                Search Livsmedelsverket
              </button>
            </div>
          </div>

          <div className="px-4 pt-2">
            <button
              type="button"
              onClick={() => {
                setScanLookupError(null)
                setScannerOpen(true)
              }}
              className="w-full rounded-[20px] border border-line-strong bg-surface py-2.5 text-sm font-semibold text-pine"
            >
              📷 Scan barcode
            </button>
            {scanLookingUp && <p className="mt-2 text-xs text-ink-disabled">Looking up barcode…</p>}
            {scanLookupError && <p className="mt-2 text-xs text-cat-rose-ink">{scanLookupError}</p>}
          </div>

          {/* Single scrollable region for both the search results and the form below —
              they used to be separate blocks with only the form scrollable, which made
              search results past the fold unreachable (nothing to scroll them into view). */}
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
            {ingredientFormMode === 'search' && (
              <div className="flex flex-col gap-2 border-b border-line pb-4">
                <div className="flex gap-2">
                  <input
                    value={lsvQuery}
                    onChange={(e) => setLsvQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && runLsvSearch()}
                    placeholder="e.g. kycklingfilé"
                    className="min-w-0 flex-1 rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
                  />
                  <button onClick={runLsvSearch} className="shrink-0 rounded-[20px] bg-pine px-4 py-2.5 font-semibold text-white">
                    Search
                  </button>
                </div>
                {lsvSearching && <p className="text-sm text-ink-disabled">Searching…</p>}
                {!lsvSearching && lsvResults.length === 0 && lsvQuery && (
                  <p className="text-sm text-ink-disabled">No matches — try a different search term, or switch to manual entry.</p>
                )}
                <div className="flex flex-col gap-2">
                  {lsvResults.map((f) => (
                    <button
                      key={f.nummer}
                      onClick={async () => {
                        await importLsvFood(f)
                      }}
                      className="rounded-[20px] border border-line bg-surface px-4 py-3 text-left text-sm font-medium text-ink shadow-card"
                    >
                      {f.namn}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={saveIngredientForm} className="flex flex-col gap-2">
            <input
              value={ingredientForm.name}
              onChange={(e) => setIngredientForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ingredient name"
              className="rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
            />
            <p className="text-xs text-ink-disabled">Per 100g:</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-3">
                Calories (kcal)
                <input
                  value={ingredientForm.kcal}
                  onChange={(e) => setIngredientForm((f) => ({ ...f, kcal: e.target.value }))}
                  type="number"
                  placeholder="0"
                  className="rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-3">
                Protein (g)
                <input
                  value={ingredientForm.protein}
                  onChange={(e) => setIngredientForm((f) => ({ ...f, protein: e.target.value }))}
                  type="number"
                  placeholder="0"
                  className="rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-3">
                Carbs (g)
                <input
                  value={ingredientForm.carbs}
                  onChange={(e) => setIngredientForm((f) => ({ ...f, carbs: e.target.value }))}
                  type="number"
                  placeholder="0"
                  className="rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-3">
                Fat (g)
                <input
                  value={ingredientForm.fat}
                  onChange={(e) => setIngredientForm((f) => ({ ...f, fat: e.target.value }))}
                  type="number"
                  placeholder="0"
                  className="rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-3">
                Fiber (g)
                <input
                  value={ingredientForm.fiber}
                  onChange={(e) => setIngredientForm((f) => ({ ...f, fiber: e.target.value }))}
                  type="number"
                  placeholder="0"
                  className="rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
                />
              </label>
            </div>

            <div>
              <p className="mb-1 text-xs text-ink-disabled">
                Standard portion (optional) — a quick shortcut like "tbsp" or "banana" so you don't have to type grams every time
              </p>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={ingredientForm.portionLabel}
                  onChange={(e) => setIngredientForm((f) => ({ ...f, portionLabel: e.target.value }))}
                  placeholder="e.g. tbsp, banana, scoop"
                  className="rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
                />
                <input
                  value={ingredientForm.portionGrams}
                  onChange={(e) => setIngredientForm((f) => ({ ...f, portionGrams: e.target.value }))}
                  type="number"
                  placeholder="grams each, e.g. 14"
                  className="rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
                />
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs text-ink-disabled">Category (optional) — groups the Library list</p>
              <div className="flex flex-wrap gap-1.5">
                {INGREDIENT_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setIngredientForm((f) => ({ ...f, category: f.category === c ? '' : c }))}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      ingredientForm.category === c ? 'bg-cat-emerald-tint text-cat-emerald-ink' : 'bg-track text-ink-3'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <input
                value={ingredientForm.category}
                onChange={(e) => setIngredientForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="Or type a custom category"
                className="mt-2 w-full rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
              />
            </div>

            <button type="submit" className="mt-2 rounded-[20px] bg-pine px-4 py-2.5 font-semibold text-white">
              {editingIngredient ? 'Save changes' : 'Save ingredient'}
            </button>
            </form>
          </div>
        </div>
      )}

      {scannerOpen && <BarcodeScanner onDetected={handleBarcodeDetected} onClose={() => setScannerOpen(false)} />}

      <ConfirmDialog
        open={confirmDeleteEntry !== null}
        title="Remove this entry?"
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirmDeleteEntry) removeLogEntry(confirmDeleteEntry)
          setConfirmDeleteEntry(null)
        }}
        onCancel={() => setConfirmDeleteEntry(null)}
      />

      <ConfirmDialog
        open={confirmDeleteLink !== null}
        title={`Remove "${confirmDeleteLink ? linkLabel(confirmDeleteLink) : ''}"?`}
        message="The link is removed from this list. Any recipe already imported from it stays."
        onConfirm={() => {
          if (confirmDeleteLink) deleteLink(confirmDeleteLink)
        }}
        onCancel={() => setConfirmDeleteLink(null)}
      />

      <ConfirmDialog
        open={confirmDeleteRecipe !== null}
        title={`Remove "${confirmDeleteRecipe?.name ?? ''}"?`}
        message="This deletes the recipe. Already-logged days that used it keep their totals."
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirmDeleteRecipe) deleteRecipe(confirmDeleteRecipe)
          setConfirmDeleteRecipe(null)
        }}
        onCancel={() => setConfirmDeleteRecipe(null)}
      />

      <ConfirmDialog
        open={confirmDeleteIngredient !== null}
        title={`Remove "${confirmDeleteIngredient?.name ?? ''}"?`}
        message="Recipes using this ingredient will lose that line — edit them afterward if needed."
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirmDeleteIngredient) deleteIngredient(confirmDeleteIngredient)
          setConfirmDeleteIngredient(null)
        }}
        onCancel={() => setConfirmDeleteIngredient(null)}
      />

      <ConfirmDialog
        open={confirmDuplicateName !== null}
        title={`An ingredient named "${confirmDuplicateName ?? ''}" already exists`}
        message="Save this as a separate entry anyway? (Consider searching the Library first to reuse the existing one.)"
        confirmLabel="Save anyway"
        onConfirm={saveIngredientNow}
        onCancel={() => setConfirmDuplicateName(null)}
      />
    </Screen>
  )
}
