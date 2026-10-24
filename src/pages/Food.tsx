import { useRemembered } from '../lib/useRemembered'
import { Fragment, useEffect, useState } from 'react'
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
  searchRank,
  mealUsuals,
  relativeDayLabel,
  mealInfo,
  logCounts,
  categoryLook,
  categoryRow,
  groupByCategory,
  orderedCategoryKeys,
  UNCATEGORIZED,
  mealTypes,
  ingredientCategories,
  ZERO_MACROS,
  type Macros,
  type LivsmedelsverketFood,
} from '../lib/food'
import { CATEGORY_STYLES as CAT } from '../lib/categories'
import { THEME } from '../lib/theme'
import { resolveImportedLines, type ImportedRecipe } from '../lib/recipeImport'
import { normalizeUrl, linkHost, linkLabel } from '../lib/links'
import type { FoodLogEntry, Ingredient, MealType, Recipe, RecipeIngredient, SavedLink } from '../lib/types'
import { liveOptions, type OptionRow } from '../lib/editable'
import { findOption, getOptionRows } from '../lib/optionStore'
import { useEdit } from '../contexts/EditContext'
import { EditDots, Pressable } from '../components/ItemMenu'
import { OptionSheet, type RefMover } from '../components/OptionSheet'

// A meal is stored on both log entries and recipes; ids carry a table prefix so one delete can
// move (and Undo move back) both.
const MEAL_REFS: RefMover = {
  noun: (n) => `${n} logged ${n === 1 ? 'entry or recipe' : 'entries and recipes'}`,
  valueOf: (r) => r.key,
  noneLabel: 'No meal',
  find: async (key) => {
    const [{ data: logs }, { data: recipes }] = await Promise.all([
      supabase.from('food_log_entries').select('id').eq('meal_type', key).throwOnError(),
      supabase.from('recipes').select('id').eq('meal_type', key).throwOnError(),
    ])
    return [...(logs ?? []).map((r) => `log:${r.id}`), ...(recipes ?? []).map((r) => `recipe:${r.id}`)]
  },
  move: async (ids, to) => {
    const of = (prefix: string) => ids.filter((i) => i.startsWith(prefix)).map((i) => i.slice(prefix.length))
    const logs = of('log:')
    const recipes = of('recipe:')
    if (logs.length) await supabase.from('food_log_entries').update({ meal_type: to }).in('id', logs).throwOnError()
    if (recipes.length) await supabase.from('recipes').update({ meal_type: to }).in('id', recipes).throwOnError()
  },
}

// An ingredient stores its category's name as text, so a rename rewrites those rows too.
const CATEGORY_REFS: RefMover = {
  noun: (n) => `${n} ${n === 1 ? 'ingredient' : 'ingredients'}`,
  valueOf: (r) => r.label,
  noneLabel: 'Uncategorised',
  find: async (label) => ((await supabase.from('ingredients').select('id').eq('category', label).throwOnError()).data ?? []).map((r) => r.id as string),
  move: async (ids, to) => {
    await supabase.from('ingredients').update({ category: to }).in('id', ids).throwOnError()
  },
}
const renameCategory = async (from: string, to: string) => {
  await supabase.from('ingredients').update({ category: to }).eq('category', from).throwOnError()
}

function MealTypePicker({ value, onChange }: { value: MealType | null; onChange: (v: MealType | null) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {mealTypes().map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(value === m ? null : m)}
          className={`rounded-xl py-1.5 text-xs font-medium transition ${
            value === m ? 'bg-cat-emerald-tint text-cat-emerald-ink' : 'bg-track text-ink-3'
          }`}
        >
          {mealInfo(m).icon} {mealInfo(m).label}
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
  /** In a variant: the ingredient this row replaced ("Blandfärs"), shown on the row. */
  replaces?: string
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

// The quantity sheet's presets: `options` rows (kinds 'serving_preset' for recipes, 'gram_preset'
// for ingredients; meta.value = the amount, label = what the cell shows), edited in place in the
// sheet. Anything off-preset goes through the ⌨ escape.
const presetKind = (kind: 'recipe' | 'ingredient') => (kind === 'recipe' ? 'serving_preset' : 'gram_preset')
const quantityPresets = (kind: 'recipe' | 'ingredient') =>
  liveOptions(getOptionRows(), presetKind(kind)).map((row) => ({ row, label: row.label, value: Number(row.meta.value) }))
const isPreset = (kind: 'recipe' | 'ingredient', quantity: number) => quantityPresets(kind).some((p) => p.value === quantity)

type FoodSubTab = 'log' | 'recipes' | 'library' | 'links'
const SUB_TABS: FoodSubTab[] = ['log', 'recipes', 'library', 'links']
const SUB_TAB_LABELS: Record<FoodSubTab, string> = { log: 'Log', recipes: 'Recipes', library: 'Library', links: 'Links' }

const MACRO_KEYS = ['protein', 'carbs', 'fat'] as const
const MACRO_LABEL = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' } as const
// Same three tints as the macro split bars elsewhere in the app.
const MACRO_COLOR = { protein: '#a8cfc0', carbs: '#e0cf9a', fat: '#e6b39f' } as const

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

export function Food() {
  const [subTab, setSubTab] = useRemembered<FoodSubTab>('food', 'log', SUB_TABS)
  const [recipeSearchQuery, setRecipeSearchQuery] = useState('')
  const [librarySearchQuery, setLibrarySearchQuery] = useState('')
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [recipeLines, setRecipeLines] = useState<Map<string, RecipeIngredient[]>>(new Map())
  const [entries, setEntries] = useState<FoodLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const [logDate, setLogDate] = useState(todayISO())
  // The meal the Log tab is focused on — seeded from the clock, then whatever you tap. Its
  // logged items and your usuals for it show underneath.
  const [selectedMeal, setSelectedMeal] = useState<MealType>(() => defaultMealTypeForNow())
  // Meal types and ingredient categories are edited in place: ✎ edit mode or a long-press.
  const { editing } = useEdit()
  const [optionSheet, setOptionSheet] = useState<{ kind: 'meal_type' | 'ingredient_category' | 'serving_preset' | 'gram_preset'; row: OptionRow | null } | null>(null)
  const [addLogOpen, setAddLogOpen] = useState(false)
  const [addLogQuery, setAddLogQuery] = useState('')
  const [addLogFilter, setAddLogFilter] = useState<'all' | 'recipe' | 'ingredient'>('all')
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
  // Set while the builder makes a variant: the original it groups under, and whether the
  // name is still ours to fill in from the swaps (it stops being once you type in it).
  const [variantOf, setVariantOf] = useState<Recipe | null>(null)
  const [variantAutoName, setVariantAutoName] = useState(false)
  // Recipes list: originals whose variants are folded open.
  const [openVariantGroups, setOpenVariantGroups] = useState<Set<string>>(new Set())
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
  const [ingredientFormOrigin, setIngredientFormOrigin] = useState<'library' | 'recipe' | 'log'>('library')
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
  const [macroGoals, setMacroGoals] = useState<{ protein: number | null; carbs: number | null; fat: number | null }>({
    protein: null,
    carbs: null,
    fat: null,
  })
  const [macroGoalsOpen, setMacroGoalsOpen] = useState(false)
  const [macroGoalDraft, setMacroGoalDraft] = useState({ protein: '', carbs: '', fat: '' })
  const [latestWeight, setLatestWeight] = useState<number | null>(null)
  // The Log tab's quick-add list shows a handful; this opens the rest.
  const [showAllUsuals, setShowAllUsuals] = useState(false)

  // Recipes browsing: a meal filter ANDed with the text search, plus a sort.
  const [mealTypeFilter, setMealTypeFilter] = useState<MealType | 'all' | 'none'>('all')
  const [recipeSort, setRecipeSort] = useState<RecipeSort>('logged')
  // Library browsing: one list, narrowed by a chip — recent, all, or a category — and the
  // hero search, sorted by the sort chip.
  const [libraryFilter, setLibraryFilter] = useState<string>('all')
  const [categorySort, setCategorySort] = useState<CategorySort>('az')

  async function load() {
    setLoading(true)
    const [
      { data: ingredientRows },
      { data: recipeRowsData },
      { data: recipeLineRows },
      { data: entryRows },
      { data: budgetRow },
      { data: linkRows },
      { data: settingsRow },
      { data: weightRow },
    ] = await Promise.all([
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
        supabase.from('user_settings').select('protein_goal, carbs_goal, fat_goal').maybeSingle(),
        // For the protein suggestion in the targets sheet (≈1.8 g per kg).
        supabase.from('journal_entries').select('value_numeric').eq('type', 'weight').order('date', { ascending: false }).limit(1).maybeSingle(),
      ])
    const num = (v: unknown) => (v != null ? Number(v) : null)
    setMacroGoals({ protein: num(settingsRow?.protein_goal), carbs: num(settingsRow?.carbs_goal), fat: num(settingsRow?.fat_goal) })
    setLatestWeight(num(weightRow?.value_numeric))
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
    setAddLogFilter('all')
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
    setQuantifyFreeform(quantity != null && !isPreset(kind, quantity))
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
    setQuantifyFreeform(!isPreset(entry.recipe_id ? 'recipe' : 'ingredient', existing))
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
    mealTypes().map((meal) => {
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
        icon: recipe.meal_type ? mealInfo(recipe.meal_type).icon : '🍽',
      }
    }
    const ingredient = ingredientsById.get(ref.id)
    if (!ingredient) return null
    return { name: ingredient.name, kcal: scaleMacros(ingredientMacros(ingredient), quantity).kcal, icon: '🥗' }
  }

  // Per meal, not per day — see mealUsuals. Recomputed as the selected meal changes.
  const usuals = mealUsuals(entries, selectedMeal, describeRef, { recent: 3, frequent: 7 })

  // The app deliberately has no global daily calorie goal (days vary too much for one to
  // mean anything). A "stay under budget" task on Today is the one place a target does
  // exist, so the "N left" chip reads from that when there is one, and is absent otherwise.
  const kcalLeft = calorieBudget != null ? calorieBudget - dayTotal.kcal : null

  // Flex weights for the macro split bar — grams, not calories, matching the design.
  // Each macro's share of the day's energy (4/4/9 kcal per gram).
  const macroKcal = dayTotal.protein * 4 + dayTotal.carbs * 4 + dayTotal.fat * 9
  const kcalShare = {
    protein: macroKcal ? ((dayTotal.protein * 4) / macroKcal) * 100 : 0,
    carbs: macroKcal ? ((dayTotal.carbs * 4) / macroKcal) * 100 : 0,
    fat: macroKcal ? ((dayTotal.fat * 9) / macroKcal) * 100 : 0,
  }

  function openMacroGoals() {
    const str = (n: number | null) => (n != null ? String(round(n)) : '')
    setMacroGoalDraft({ protein: str(macroGoals.protein), carbs: str(macroGoals.carbs), fat: str(macroGoals.fat) })
    setMacroGoalsOpen(true)
  }

  // A starting point, not a prescription: protein ≈1.8 g per kg of the latest weigh-in, fat
  // ≈25% of the calorie budget, carbs whatever the budget has left. Without a budget only
  // protein can be suggested.
  const suggestedMacros = (() => {
    const protein = latestWeight ? Math.round((latestWeight * 1.8) / 5) * 5 : null
    if (!calorieBudget || !protein) return { protein, carbs: null, fat: null }
    const fat = Math.round((calorieBudget * 0.25) / 9 / 5) * 5
    const carbs = Math.max(0, Math.round((calorieBudget - protein * 4 - fat * 9) / 4 / 5) * 5)
    return { protein, carbs, fat }
  })()

  async function saveMacroGoals(e: React.FormEvent) {
    e.preventDefault()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const val = (s: string) => (s.trim() && Number(s) > 0 ? Number(s) : null)
    const next = { protein: val(macroGoalDraft.protein), carbs: val(macroGoalDraft.carbs), fat: val(macroGoalDraft.fat) }
    setMacroGoals(next)
    setMacroGoalsOpen(false)
    await supabase.from('user_settings').upsert({ user_id: user.id, protein_goal: next.protein, carbs_goal: next.carbs, fat_goal: next.fat })
  }

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
    .filter((r) => mealTypeFilter === 'all' || (mealTypeFilter === 'none' ? !r.meal_type : r.meal_type === mealTypeFilter))
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

  // The last few distinct ingredients logged — what most sessions actually reach for.
  const recentIngredients = [...counts.lastIngredient.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([id]) => ingredientsById.get(id))
    .filter((i): i is Ingredient => i != null)
    .slice(0, 12)

  // Recent keeps its own order (newest first); everything else follows the sort chip.
  const libraryList =
    libraryFilter === 'recent'
      ? recentIngredients.filter((i) => matchesSearch(i.name, librarySearchQuery))
      : (libraryFilter === 'all' ? ingredients : (ingredientGroups.get(libraryFilter) ?? []))
          .filter((i) => matchesSearch(i.name, librarySearchQuery))
          .sort((a, b) => {
            switch (categorySort) {
              case 'used':
                return (counts.byIngredient.get(b.id) ?? 0) - (counts.byIngredient.get(a.id) ?? 0) || a.name.localeCompare(b.name)
              case 'protein':
                return b.protein_per_100g - a.protein_per_100g
              case 'az':
                return a.name.localeCompare(b.name, 'sv')
            }
          })

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

  // One library row: the category's glyph, name and per-100 g numbers, + to log it.
  // Tapping the row edits it. `glyph` is for mixed lists (All, Recent), where the category
  // isn't otherwise obvious; `divider` draws the line above it.
  function renderIngredientRow(ingredient: Ingredient, glyph: boolean, divider: boolean) {
    const look = categoryLook(ingredient.category ?? UNCATEGORIZED)
    const used = counts.byIngredient.get(ingredient.id) ?? 0
    return (
      <div className={`flex items-center gap-3 px-3 py-2.5 ${divider ? 'border-t border-line' : ''}`}>
        <button onClick={() => openEditIngredient(ingredient)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Edit ${ingredient.name}`}>
          {glyph && (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[15px]" style={{ background: look.tint }}>
              {look.glyph}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{ingredient.name}</span>
            <span className="block truncate text-[11px] text-ink-muted">
              <span className="font-semibold text-ink-2">{round(ingredient.kcal_per_100g)} kcal</span> · P {round(ingredient.protein_per_100g)} · C{' '}
              {round(ingredient.carbs_per_100g)} · F {round(ingredient.fat_per_100g)} /100g
              {ingredient.portion_label && ingredient.portion_grams ? ` · 1 ${ingredient.portion_label} = ${ingredient.portion_grams}g` : ''}
              {used > 0 ? ` · ${used}×` : ''}
            </span>
          </span>
        </button>
        <button
          onClick={() => logFromList('ingredient', ingredient.id, ingredient.name)}
          aria-label={`Log ${ingredient.name}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cat-emerald-tint text-base font-semibold text-cat-emerald-ink"
        >
          +
        </button>
      </div>
    )
  }

  // The add-food sheet is one list, not a recipes block then an ingredients block: names
  // that start with what you typed come first, then whatever you log most, so the thing
  // you meant is at the top whichever kind it is. With no query it's everything, most-used first.
  const addLogResults = [
    ...(addLogFilter === 'ingredient' ? [] : recipes).map((r) => ({
      kind: 'recipe' as const,
      id: r.id,
      name: r.name,
      used: counts.byRecipe.get(r.id) ?? 0,
    })),
    ...(addLogFilter === 'recipe' ? [] : ingredients).map((i) => ({
      kind: 'ingredient' as const,
      id: i.id,
      name: i.name,
      used: counts.byIngredient.get(i.id) ?? 0,
    })),
  ]
    .filter((r) => matchesSearch(r.name, addLogQuery))
    .sort(
      (a, b) =>
        searchRank(a.name, addLogQuery) - searchRank(b.name, addLogQuery) || b.used - a.used || a.name.localeCompare(b.name),
    )

  // "Can't find it?" from the add-food sheet: make the ingredient, then land straight in
  // the quantity sheet for the meal you were adding to (see the 'log' origin in
  // saveIngredientNow) instead of a detour through Library and back.
  function newIngredientFromLog(mode: 'manual' | 'search' | 'scan') {
    const q = addLogQuery.trim()
    setAddLogOpen(false)
    openNewIngredient('log')
    if (mode === 'manual') setIngredientForm((f) => ({ ...f, name: q }))
    if (mode === 'search') {
      setIngredientFormMode('search')
      setLsvQuery(q)
      if (q) runLsvSearch(q)
    }
    if (mode === 'scan') setScannerOpen(true)
  }


  // --- Recipe builder ---

  function openNewRecipe() {
    setEditingRecipe(null)
    setVariantOf(null)
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
    setVariantOf(null)
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

  // A variant starts as a copy of the recipe, filed under its original (a variant of a
  // variant still groups under the first one, so a family stays one level deep). Tapping
  // an ingredient swaps it with the grams kept; the name follows the swaps until edited.
  function openVariant(recipe: Recipe) {
    const root = (recipe.variant_of && recipesById.get(recipe.variant_of)) || recipe
    openEditRecipe(recipe)
    setEditingRecipe(null)
    setVariantOf(root)
    setVariantAutoName(true)
    setRecipeName(`${root.name} – variant`)
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
      const next = recipeRows.map((r, i) =>
        i === pickingIngredientFor
          ? {
              ...r,
              // Remember what a variant row started as, once — swapping twice still says
              // it replaced the original's ingredient.
              replaces: variantOf && r.ingredientId && r.ingredientId !== ingredient.id ? (r.replaces ?? r.name) : r.replaces,
              ingredientId: ingredient.id,
              name: ingredient.name,
              // An imported row often arrives with no grams (a volume or count unit we
              // couldn't convert). Once it has an ingredient, its portion is the best
              // starting point available.
              grams: r.grams || (ingredient.portion_grams != null ? String(ingredient.portion_grams) : ''),
            }
          : r,
      )
      setRecipeRows(next)
      if (variantOf && variantAutoName) {
        const swappedIn = next.filter((r) => r.replaces).map((r) => r.name)
        if (swappedIn.length) setRecipeName(`${variantOf.name} – ${swappedIn.join(' & ')}`)
      }
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
        .insert({ name, servings, meal_type: recipeMealType, user_id: user.id, variant_of: variantOf?.id ?? null })
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
    // Land on the new variant's family, folded open, so it's visible where it was filed.
    if (variantOf) setOpenVariantGroups((open) => new Set(open).add(variantOf.id))
    setVariantOf(null)
    load()
  }

  async function deleteRecipe(recipe: Recipe) {
    setRecipes((rs) => rs.filter((r) => r.id !== recipe.id))
    await supabase.from('recipes').delete().eq('id', recipe.id)
  }

  // --- Ingredient library ---

  function openNewIngredient(origin: 'library' | 'recipe' | 'log' = 'library') {
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

  async function runLsvSearch(query = lsvQuery) {
    const q = query.trim()
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
    } else if (ingredientFormOrigin === 'log') {
      // Created from the add-food sheet's "Can't find it?" — go on to log it right away.
      const { data, error } = await supabase
        .from('ingredients')
        .insert({ ...payload, source: 'manual', user_id: user.id })
        .select()
        .single()
      if (!error && data) {
        setIngredients((is) => [...is, data])
        beginQuantify('ingredient', data.id, data.name)
      }
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
      title="Food"
      onRefresh={load}
      hero={
        (
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
              <div className="mt-3 flex items-end justify-between gap-3">
                <p className="flex items-baseline gap-[7px] leading-none">
                  <span className="text-[27px] font-semibold">{round(dayTotal.kcal).toLocaleString()}</span>
                  <span className="text-xs font-medium text-white/75">
                    {calorieBudget != null ? `of ${round(calorieBudget).toLocaleString()} kcal` : 'kcal logged'}
                  </span>
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
              {/* Protein / carbs / fat, each against its own target when one is set — the
                  overview the old three-colour split bar only hinted at. Tap to set targets. */}
              <button onClick={openMacroGoals} className="mt-3 grid w-full grid-cols-3 gap-2 text-left">
                {MACRO_KEYS.map((key) => {
                  const grams = dayTotal[key]
                  const goal = macroGoals[key]
                  const pct = goal ? Math.min(100, (grams / goal) * 100) : null
                  return (
                    <span key={key} className="flex flex-col gap-1 rounded-2xl bg-white/12 px-2.5 py-2">
                      <span className="text-[10px] font-semibold tracking-[0.06em] text-white/70">{MACRO_LABEL[key].toUpperCase()}</span>
                      <span className="text-[15px] font-semibold leading-none text-white">
                        {round(grams)}
                        <span className="text-[11px] font-medium text-white/65">{goal ? ` / ${round(goal)} g` : ' g'}</span>
                      </span>
                      {/* Against the target when there is one; otherwise its share of the
                          day's calories, said in words so the bar isn't a mystery. */}
                      <span className="h-1 overflow-hidden rounded-full bg-white/20">
                        <span className="block h-full rounded-full" style={{ width: `${pct ?? kcalShare[key]}%`, background: MACRO_COLOR[key] }} />
                      </span>
                      <span className="text-[10px] font-medium text-white/65">
                        {goal ? (grams >= goal ? 'target reached' : `${round(goal - grams)} g to go`) : `${round(kcalShare[key])}% of kcal`}
                      </span>
                    </span>
                  )
                })}
              </button>
              {!macroGoals.protein && !macroGoals.carbs && !macroGoals.fat && (
                <button onClick={openMacroGoals} className="mt-2 text-[11px] font-semibold text-white/80">
                  Set daily macro targets ›
                </button>
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
          {/* The meal strip: the day at a glance, and the meal selector. */}
          <div className="grid shrink-0 gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(mealTypes().length, 1)}, minmax(0, 1fr))` }}>
            {mealTypes().map((meal) => {
              const look = mealInfo(meal)
              const kcal = mealKcal.get(meal) ?? null
              const selected = selectedMeal === meal
              const editMeal = () => setOptionSheet({ kind: 'meal_type', row: findOption('meal_type', meal) ?? null })
              return (
                <span key={meal} className="relative flex">
                <Pressable
                  onLongPress={editMeal}
                  onClick={() => {
                    setSelectedMeal(meal)
                    setShowAllUsuals(false)
                  }}
                  aria-label={mealInfo(meal).label}
                  aria-pressed={selected}
                  className={`flex w-full flex-col items-center gap-[3px] rounded-[18px] px-1 py-2.5 ${selected ? '' : 'border border-line bg-surface'}`}
                  style={selected ? { background: look.accent, boxShadow: `0 4px 12px ${look.accent}4d` } : undefined}
                >
                  <span className="text-[15px] leading-none">{look.icon}</span>
                  <span className="text-[13px] font-semibold leading-none" style={{ color: selected ? '#fff' : kcal == null ? '#a09a8c' : look.ink }}>
                    {kcal == null ? '—' : round(kcal).toLocaleString()}
                  </span>
                  <span
                    className={`text-[9px] leading-none ${selected ? 'font-semibold' : 'font-medium text-ink-muted'}`}
                    style={selected ? { color: 'rgba(255,255,255,.85)' } : undefined}
                  >
                    {mealInfo(meal).label}
                  </span>
                </Pressable>
                {editing && (
                  <span className="absolute -right-1 -top-1.5">
                    <EditDots onClick={editMeal} label={look.label} />
                  </span>
                )}
                </span>
              )
            })}
          </div>
          {editing && (
            <button onClick={() => setOptionSheet({ kind: 'meal_type', row: null })} className="-mt-1 self-start text-[12px] font-medium text-pine">
              + New meal
            </button>
          )}

          {/* Search sits right under the strip, always visible, so something you haven't
              logged for this meal before is one tap away. */}
          <div className="flex shrink-0 gap-2">
            <button
              onClick={openAddLog}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[18px] border border-line bg-surface px-3.5 py-3 text-left shadow-card"
            >
              <span className="shrink-0 text-sm">🔍</span>
              <span className="truncate text-[13px] font-medium text-ink-muted">
                Search food for {mealInfo(selectedMeal).label.toLowerCase()}
              </span>
            </button>
            <button
              onClick={() => newIngredientFromLog('scan')}
              aria-label="Scan barcode"
              className="flex w-[48px] shrink-0 items-center justify-center rounded-[18px] border border-line bg-surface text-base shadow-card"
            >
              📷
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-ink-disabled">Loading…</p>
          ) : (
            (() => {
              const look = mealInfo(selectedMeal)
              const logged = dayEntriesByMeal.get(selectedMeal) ?? []
              const mealMacros = logged.reduce((sum, e) => addMacros(sum, macrosFor(e)), ZERO_MACROS)
              // Recent and most-logged as one list: what you had lately first, then your
              // standbys — mealUsuals already keeps the two from repeating each other.
              // Already on this meal today? It's in the list above; don't offer it twice.
              const loggedKeys = new Set(logged.map((e) => (e.recipe_id ? `recipe:${e.recipe_id}` : `ingredient:${e.ingredient_id}`)))
              const picks = [...usuals.recent, ...usuals.frequent].filter((u) => !loggedKeys.has(`${u.ref.kind}:${u.ref.id}`))
              const shown = showAllUsuals ? picks : picks.slice(0, 5)
              const label = mealInfo(selectedMeal).label.toLowerCase()
              return (
                <>
                  {logged.length > 0 && (
                    <div className="shrink-0 overflow-hidden rounded-[20px] border border-line bg-surface shadow-card">
                      <div className="flex items-center justify-between gap-2.5 px-3.5 py-2.5" style={{ background: look.tint }}>
                        <span className="text-[13px] font-semibold" style={{ color: look.ink }}>
                          {look.icon} {mealInfo(selectedMeal).label}
                        </span>
                        <span className="shrink-0 text-[11px] font-semibold" style={{ color: look.ink }}>
                          {round(mealMacros.kcal).toLocaleString()} kcal · P {round(mealMacros.protein)} C {round(mealMacros.carbs)} F{' '}
                          {round(mealMacros.fat)}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        {logged.map((entry, i) => {
                          const m = macrosFor(entry)
                          return (
                            <div key={entry.id} className={`flex items-center gap-2.5 px-3.5 py-2.5 ${i > 0 ? 'border-t border-line' : ''}`}>
                              <button onClick={() => beginEditEntry(entry)} className="min-w-0 flex-1 text-left">
                                <span className="block truncate text-[13px] font-medium text-ink">{entryLabel(entry)}</span>
                                <span className="block text-[11px] font-medium text-ink-muted">
                                  {round(m.kcal)} kcal · P {round(m.protein)} · C {round(m.carbs)} · F {round(m.fat)}
                                </span>
                              </button>
                              <button
                                onClick={() => setConfirmDeleteEntry(entry)}
                                className="shrink-0 px-1 text-[13px] text-ink-faint"
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

                  {picks.length > 0 ? (
                    <>
                      <div className="flex shrink-0 items-center gap-2.5">
                        <span className="text-[10px] font-semibold tracking-[0.07em] text-ink-muted">
                          YOUR USUAL {mealInfo(selectedMeal).label.toUpperCase()}S
                        </span>
                        <span className="h-px flex-1 bg-line-strong" />
                      </div>
                      <div className="flex shrink-0 flex-col overflow-hidden rounded-[20px] border border-line bg-surface shadow-card">
                        {shown.map((usual, i) => {
                          const amount =
                            usual.ref.kind === 'recipe'
                              ? `${usual.quantity} serving${usual.quantity === 1 ? '' : 's'}`
                              : `${round(usual.quantity)} g`
                          return (
                            <button
                              key={`${usual.ref.kind}:${usual.ref.id}`}
                              onClick={() => beginQuantify(usual.ref.kind, usual.ref.id, usual.name, usual.quantity)}
                              className={`flex items-center gap-3 px-3.5 py-2.5 text-left ${i > 0 ? 'border-t border-line' : ''}`}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-ink">{usual.name}</span>
                                <span className="block truncate text-[11px] font-medium text-ink-muted">
                                  {amount} · {round(usual.kcal)} kcal · {relativeDayLabel(usual.lastDate, logDate)}
                                  {usual.count > 1 ? ` · ${usual.count}×` : ''}
                                </span>
                              </span>
                              <span
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base font-semibold"
                                style={{ background: look.tint, color: look.ink }}
                              >
                                +
                              </span>
                            </button>
                          )
                        })}
                        {picks.length > 5 && (
                          <button
                            onClick={() => setShowAllUsuals((v) => !v)}
                            className="border-t border-line py-2.5 text-xs font-semibold text-pine"
                          >
                            {showAllUsuals ? 'Show fewer' : `Show ${picks.length - 5} more`}
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    logged.length === 0 && (
                      <p className="shrink-0 px-1 text-[13px] text-ink-muted">
                        Nothing logged for {label} yet — search above, and what you log here will show up as one-tap suggestions next
                        time.
                      </p>
                    )
                  )}
                </>
              )
            })()
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
          <ChipRail
            options={[
              { id: 'all' as const, label: `All ${recipes.length}` },
              ...mealTypes().filter((m) => (recipeMealCounts.get(m) ?? 0) > 0 || mealTypeFilter === m).map((m) => ({
                id: m,
                label: `${mealInfo(m).icon} ${mealInfo(m).label} ${recipeMealCounts.get(m) ?? 0}`,
              })),
              ...(recipes.some((r) => !r.meal_type) ? [{ id: 'none' as const, label: `Untagged ${recipes.filter((r) => !r.meal_type).length}` }] : []),
            ]}
            value={mealTypeFilter}
            onChange={setMealTypeFilter}
          />

          {/* One slim toolbar: sort on the left, the two ways in on the right. */}
          <div className="flex items-center gap-2">
            <label className="flex min-w-0 items-center gap-1 text-xs font-medium text-ink-3">
              <span className="shrink-0">Sort</span>
              <select
                value={recipeSort}
                onChange={(e) => setRecipeSort(e.target.value as RecipeSort)}
                aria-label="Sort recipes"
                className="min-w-0 bg-transparent text-xs font-semibold text-ink-2 outline-none"
              >
                {(Object.keys(RECIPE_SORT_LABELS) as RecipeSort[]).map((s) => (
                  <option key={s} value={s}>
                    {RECIPE_SORT_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <span className="flex-1" />
            <button
              onClick={() => {
                setImportUrl('')
                setImportError(null)
                setImportOpen(true)
              }}
              className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-pine"
            >
              🔗 Import
            </button>
            <button onClick={openNewRecipe} className="shrink-0 rounded-full bg-pine px-3 py-1.5 text-xs font-semibold text-white">
              + New
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-ink-disabled">Loading…</p>
          ) : recipes.length === 0 ? (
            <p className="text-sm text-ink-disabled">No recipes yet — import one from a link or build one with + New.</p>
          ) : sortedRecipes.length === 0 ? (
            <p className="text-sm text-ink-disabled">
              {recipeSearchQuery ? `No recipes match "${recipeSearchQuery}".` : 'No recipes tagged for that meal.'}
            </p>
          ) : (
            // A compact list: one row per recipe with what matters for picking one — energy
            // and macros per serving, how often it's logged — and + to log it. Tap the row
            // for ingredients and editing.
            (() => {
              // Variants sit under their original: an original whose variants are also in
              // view shows a "N variants" fold; a variant whose original is filtered out
              // stands on its own. A search opens every fold, since you're looking for one.
              const visibleIds = new Set(sortedRecipes.map((r) => r.id))
              const variantsOf = new Map<string, Recipe[]>()
              for (const r of sortedRecipes) {
                if (r.variant_of && visibleIds.has(r.variant_of)) variantsOf.set(r.variant_of, [...(variantsOf.get(r.variant_of) ?? []), r])
              }
              const top = sortedRecipes.filter((r) => !(r.variant_of && visibleIds.has(r.variant_of)))
              const row = (recipe: Recipe, divider: boolean, variant: boolean) => {
                const perServing = recipeMacros(recipe)
                const logged = counts.byRecipe.get(recipe.id) ?? 0
                const look = recipe.meal_type ? mealInfo(recipe.meal_type) : null
                const family = variantsOf.get(recipe.id) ?? []
                const open = openVariantGroups.has(recipe.id) || !!recipeSearchQuery.trim()
                // A variant's name usually repeats its original's ("Köttfärssås – Kyckling");
                // under the original, the part after the dash is what tells it apart.
                const parent = recipe.variant_of ? recipesById.get(recipe.variant_of) : undefined
                const label =
                  variant && parent && recipe.name.startsWith(`${parent.name} – `) ? recipe.name.slice(parent.name.length + 3) : recipe.name
                return (
                  <div key={recipe.id} className={`flex items-center gap-3 py-2.5 pr-3 ${variant ? 'bg-page/60 pl-8' : 'pl-3'} ${divider ? 'border-t border-line' : ''}`}>
                    <button onClick={() => setViewingRecipe(recipe)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span
                        className={`flex shrink-0 items-center justify-center text-base ${variant ? 'h-8 w-8 rounded-[11px] text-sm' : 'h-10 w-10 rounded-[13px]'}`}
                        style={{ background: look?.tint ?? THEME.track }}
                      >
                        {variant ? '⇄' : (look?.icon ?? '🍽')}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">{label}</span>
                        <span className="block truncate text-[11px] font-medium text-ink-muted">
                          <span className="font-semibold text-ink-2">{round(perServing.kcal)} kcal</span> · P {round(perServing.protein)} · C{' '}
                          {round(perServing.carbs)} · F {round(perServing.fat)}
                          {logged > 0 && ` · ${logged}×`}
                        </span>
                      </span>
                    </button>
                    {family.length > 0 && (
                      <button
                        onClick={() =>
                          setOpenVariantGroups((prev) => {
                            const next = new Set(prev)
                            if (next.has(recipe.id)) next.delete(recipe.id)
                            else next.add(recipe.id)
                            return next
                          })
                        }
                        className="shrink-0 rounded-full bg-track px-2.5 py-1 text-[11px] font-semibold text-ink-2"
                        aria-expanded={open}
                      >
                        {family.length} variant{family.length === 1 ? '' : 's'} {open ? '⌃' : '⌄'}
                      </button>
                    )}
                    <button
                      onClick={() => logFromList('recipe', recipe.id, recipe.name)}
                      aria-label={`Log ${recipe.name}`}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cat-emerald-tint text-base font-semibold text-cat-emerald-ink"
                    >
                      +
                    </button>
                  </div>
                )
              }
              return (
                <div className="flex flex-col overflow-hidden rounded-[20px] border border-line bg-surface shadow-card">
                  {top.map((recipe, i) => (
                    <Fragment key={recipe.id}>
                      {row(recipe, i > 0, false)}
                      {(openVariantGroups.has(recipe.id) || !!recipeSearchQuery.trim()) &&
                        (variantsOf.get(recipe.id) ?? []).map((v) => row(v, true, true))}
                    </Fragment>
                  ))}
                </div>
              )
            })()
          )}
        </>
      )}

      {/* Library: one list. The chips pick recent, everything, or one category; the hero
          search narrows whichever is picked; letter headings while it's A–Z. */}
      {subTab === 'library' && (
        <>
          <ChipRail
            options={[
              ...(recentIngredients.length ? [{ id: 'recent', label: '🕘 Recent' }] : []),
              { id: 'all', label: `All ${ingredients.length}` },
              ...categoryKeys.map((key) => ({
                id: key,
                label: `${categoryLook(key).glyph} ${key === UNCATEGORIZED ? 'Uncategorised' : key} ${ingredientGroups.get(key)?.length ?? 0}`,
              })),
            ]}
            value={libraryFilter}
            onChange={setLibraryFilter}
          />
          {/* Categories are edited from here: pick one in the rail, then ✎ (edit mode). */}
          {editing && (
            <div className="-mt-1 flex flex-wrap items-center gap-2 text-[12px] font-medium">
              {categoryRow(libraryFilter) && (
                <button onClick={() => setOptionSheet({ kind: 'ingredient_category', row: categoryRow(libraryFilter) ?? null })} className="flex items-center gap-1 text-pine">
                  ⋯ Edit “{libraryFilter}”
                </button>
              )}
              <button onClick={() => setOptionSheet({ kind: 'ingredient_category', row: null })} className="text-pine">
                + New category
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            {libraryFilter !== 'recent' ? (
              <label className="flex min-w-0 items-center gap-1 text-xs font-medium text-ink-3">
                <span className="shrink-0">Sort</span>
                <select
                  value={categorySort}
                  onChange={(e) => setCategorySort(e.target.value as CategorySort)}
                  aria-label="Sort ingredients"
                  className="min-w-0 bg-transparent text-xs font-semibold text-ink-2 outline-none"
                >
                  {(Object.keys(CATEGORY_SORT_LABELS) as CategorySort[]).map((sort) => (
                    <option key={sort} value={sort}>
                      {CATEGORY_SORT_LABELS[sort]}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="text-xs font-medium text-ink-3">Last used first</span>
            )}
            <span className="flex-1" />
            <button
              onClick={() => {
                setScanLookupError(null)
                openNewIngredient('library')
                setScannerOpen(true)
              }}
              className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-pine"
            >
              📷 Scan
            </button>
            <button onClick={() => openNewIngredient('library')} className="shrink-0 rounded-full bg-pine px-3 py-1.5 text-xs font-semibold text-white">
              + New
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-ink-disabled">Loading…</p>
          ) : ingredients.length === 0 ? (
            <p className="text-sm text-ink-disabled">No ingredients yet — scan a barcode or add one with + New.</p>
          ) : libraryList.length === 0 ? (
            <p className="text-sm text-ink-disabled">
              {librarySearchQuery ? `Nothing here matches "${librarySearchQuery}".` : 'Nothing in this category yet.'}
            </p>
          ) : (
            <div className="flex flex-col overflow-hidden rounded-[20px] border border-line bg-surface shadow-card">
              {libraryList.map((ingredient, i) => {
                const letter = ingredient.name.charAt(0).toUpperCase()
                const previousLetter = i > 0 ? libraryList[i - 1].name.charAt(0).toUpperCase() : null
                // Letter headings help find your way in a long A–Z list; in a short one they're noise.
                const heading = libraryFilter !== 'recent' && categorySort === 'az' && libraryList.length > 15 && letter !== previousLetter
                return (
                  <div key={ingredient.id}>
                    {heading && (
                      <p className={`bg-page px-3.5 py-1 text-[11px] font-semibold text-ink-muted ${i > 0 ? 'border-t border-line' : ''}`}>{letter}</p>
                    )}
                    {renderIngredientRow(ingredient, libraryFilter === 'all' || libraryFilter === 'recent', i > 0 && !heading)}
                  </div>
                )
              })}
            </div>
          )}

          <p className="text-[11px] text-ink-disabled">Nutrition data via Livsmedelsverket's Livsmedelsdatabasen (CC BY 4.0).</p>
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
                <span className="min-w-0">
                  <h2 className="text-lg font-bold text-ink">{viewingRecipe.name}</h2>
                  {viewingRecipe.variant_of && recipesById.get(viewingRecipe.variant_of) && (
                    <p className="text-xs font-medium text-ink-muted">Variant of {recipesById.get(viewingRecipe.variant_of)!.name}</p>
                  )}
                </span>
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
                    openVariant(recipe)
                  }}
                  className="shrink-0 rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 font-semibold text-pine"
                >
                  ⧉ Variant
                </button>
                <button
                  onClick={() => {
                    const recipe = viewingRecipe
                    setViewingRecipe(null)
                    openEditRecipe(recipe)
                  }}
                  className="flex-1 rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 font-semibold text-pine"
                >
                  Edit
                </button>
                <button
                  onClick={() => {
                    const recipe = viewingRecipe
                    setViewingRecipe(null)
                    logFromList('recipe', recipe.id, recipe.name)
                  }}
                  className="flex-1 rounded-[20px] bg-pine px-4 py-2.5 font-semibold text-white"
                >
                  + Log
                </button>
              </div>
            </div>
          )
        })()}

      {/* Add to log — one ranked list across recipes and ingredients, headed by the meal
          it adds to, and never a dead end: "Can't find it?" makes the ingredient from here. */}
      {addLogOpen &&
        (() => {
          const look = mealInfo(selectedMeal)
          const q = addLogQuery.trim()
          const notFound = (
            <div className="flex flex-col gap-1.5 rounded-[20px] border border-dashed border-line-strong bg-surface p-3.5">
              <span className="text-[13px] font-semibold text-ink">
                {addLogResults.length === 0 && q ? `Nothing called “${q}” yet` : "Can't find it?"}
              </span>
              <button onClick={() => newIngredientFromLog('search')} className="text-left text-[13px] font-semibold text-pine">
                🔎 Search Livsmedelsverket{q ? ` for “${q}”` : ''}
              </button>
              <button onClick={() => newIngredientFromLog('scan')} className="text-left text-[13px] font-semibold text-pine">
                📷 Scan a barcode
              </button>
              <button onClick={() => newIngredientFromLog('manual')} className="text-left text-[13px] font-semibold text-pine">
                ✎ {q ? `Create “${q}” with your own numbers` : 'Create an ingredient with your own numbers'}
              </button>
              <span className="text-[10px] font-medium text-ink-muted">
                Saved to your library, then straight on to logging it for {mealInfo(selectedMeal).label.toLowerCase()}.
              </span>
            </div>
          )
          return (
            <div className="fixed inset-0 z-50 flex flex-col bg-page safe-top safe-bottom">
              <div className="flex items-center justify-between gap-3 px-4 pt-4">
                <span className="flex min-w-0 flex-col">
                  <span className="text-[11px] font-semibold tracking-[0.07em]" style={{ color: look.accent }}>
                    {logDate === todayISO() ? 'TODAY' : format(new Date(logDate + 'T00:00:00'), 'EEE d MMM').toUpperCase()}
                  </span>
                  <h2 className="truncate text-lg font-bold text-ink">
                    {look.icon} Add to {mealInfo(selectedMeal).label.toLowerCase()}
                  </h2>
                </span>
                <button onClick={() => setAddLogOpen(false)} className="shrink-0 rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2">
                  Close ✕
                </button>
              </div>
              <div className="flex flex-col gap-2.5 px-4 pt-3 pb-3">
                <div className="flex items-center gap-2.5 rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 focus-within:border-pine">
                  <span className="shrink-0 text-sm">🔍</span>
                  <input
                    autoFocus
                    value={addLogQuery}
                    onChange={(e) => setAddLogQuery(e.target.value)}
                    placeholder="Search recipes and ingredients"
                    className="min-w-0 flex-1 bg-transparent text-ink placeholder-ink-disabled outline-none"
                  />
                  {addLogQuery && (
                    <button onClick={() => setAddLogQuery('')} aria-label="Clear search" className="shrink-0 text-sm text-ink-faint">
                      ✕
                    </button>
                  )}
                </div>
                <ChipRail
                  options={[
                    { id: 'all', label: 'All' },
                    { id: 'recipe', label: `Recipes · ${recipes.length}` },
                    { id: 'ingredient', label: `Ingredients · ${ingredients.length}` },
                  ]}
                  value={addLogFilter}
                  onChange={setAddLogFilter}
                />
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 pb-4">
                {addLogResults.length === 0 && q ? (
                  notFound
                ) : (
                  <>
                    <div className="flex items-center gap-2.5">
                      <span className="text-[10px] font-semibold tracking-[0.07em] text-ink-muted">
                        {q ? `${addLogResults.length} MATCH${addLogResults.length === 1 ? '' : 'ES'}` : 'MOST-LOGGED FIRST'}
                      </span>
                      <span className="h-px flex-1 bg-line-strong" />
                    </div>
                    {addLogResults.map((r) => {
                      const recipe = r.kind === 'recipe' ? recipesById.get(r.id) : null
                      const ingredient = r.kind === 'ingredient' ? ingredientsById.get(r.id) : null
                      const glyph = recipe
                        ? recipe.meal_type
                          ? mealInfo(recipe.meal_type).icon
                          : '🍽'
                        : categoryLook(ingredient?.category ?? UNCATEGORIZED).glyph
                      const caption = recipe
                        ? `Recipe · ${round(recipeMacros(recipe).kcal)} kcal/serving`
                        : ingredient
                          ? `${ingredient.kcal_per_100g} kcal/100g${
                              ingredient.portion_label && ingredient.portion_grams
                                ? ` · 1 ${ingredient.portion_label} = ${ingredient.portion_grams}g`
                                : ''
                            }`
                          : ''
                      return (
                        <button
                          key={`${r.kind}:${r.id}`}
                          onClick={() => logFromList(r.kind, r.id, r.name)}
                          className="flex items-center gap-3 rounded-[18px] border border-line bg-surface py-2.5 pr-3 pl-2.5 text-left shadow-card"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-track text-base">{glyph}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-ink">{r.name}</span>
                            <span className="block truncate text-[11px] text-ink-muted">{caption}</span>
                          </span>
                          {r.used > 0 && <span className="shrink-0 text-[10px] font-semibold text-ink-muted">{r.used}×</span>}
                          <span
                            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[15px] font-semibold"
                            style={{ background: look.tint, color: look.ink }}
                          >
                            +
                          </span>
                        </button>
                      )
                    })}
                    <div className="mt-2">{notFound}</div>
                  </>
                )}
              </div>
            </div>
          )
        })()}

      {/* Daily macro targets. Each optional; the hero shows plain grams for any left blank. */}
      {macroGoalsOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => setMacroGoalsOpen(false)}>
          <form
            onSubmit={saveMacroGoals}
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col gap-3 rounded-t-[28px] bg-surface px-5 pb-[26px] pt-3 safe-bottom"
            style={{ boxShadow: '0 -12px 32px rgba(35,36,31,.18)' }}
          >
            <span className="mx-auto h-1 w-[38px] rounded-full bg-line-strong" />
            <div>
              <h2 className="text-lg font-bold text-ink">Daily macro targets</h2>
              <p className="mt-0.5 text-xs text-ink-muted">Grams per day. Leave one blank to just track it.</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {MACRO_KEYS.map((key) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-3">
                    <span className="h-2 w-2 rounded-full" style={{ background: MACRO_COLOR[key] }} />
                    {MACRO_LABEL[key]}
                  </span>
                  <input
                    value={macroGoalDraft[key]}
                    onChange={(e) => setMacroGoalDraft((d) => ({ ...d, [key]: e.target.value }))}
                    inputMode="numeric"
                    placeholder={suggestedMacros[key] != null ? String(suggestedMacros[key]) : 'g'}
                    className="w-full rounded-2xl border border-line-strong bg-page px-3 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
                  />
                </label>
              ))}
            </div>
            {suggestedMacros.protein != null && (
              <button
                type="button"
                onClick={() =>
                  setMacroGoalDraft({
                    protein: String(suggestedMacros.protein),
                    carbs: suggestedMacros.carbs != null ? String(suggestedMacros.carbs) : macroGoalDraft.carbs,
                    fat: suggestedMacros.fat != null ? String(suggestedMacros.fat) : macroGoalDraft.fat,
                  })
                }
                className="self-start text-left text-xs font-semibold text-pine"
              >
                Use suggestion — {suggestedMacros.protein} g protein (1.8 g/kg at {latestWeight} kg)
                {suggestedMacros.carbs != null && `, ${suggestedMacros.carbs} g carbs, ${suggestedMacros.fat} g fat`}
              </button>
            )}
            <button type="submit" className="rounded-[20px] bg-pine py-3 font-semibold text-white">
              Save targets
            </button>
          </form>
        </div>
      )}

      {/* Quantity sheet — presets rather than a keypad, because almost every log is one
          of four amounts. The ⌨ cell is the escape for the rest. */}
      {quantifying &&
        (() => {
          const kind = quantifying.kind
          const look = mealInfo(quantifyMealType ?? selectedMeal)
          const presets = quantityPresets(kind)
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
                    {kind === 'recipe' ? (recipe?.meal_type ? mealInfo(recipe.meal_type).icon : '🍽') : '🥗'}
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
                    {quantifyMealType ? mealInfo(quantifyMealType).label : 'No meal'} ⌄
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
                  <div className="grid gap-[7px]" style={{ gridTemplateColumns: `repeat(${presets.length + 1 + (editing ? 1 : 0)}, minmax(0, 1fr))` }}>
                    {presets.map((preset) => {
                      const active = !quantifyFreeform && value === preset.value
                      const editPreset = () => setOptionSheet({ kind: presetKind(kind), row: preset.row })
                      return (
                        <span key={preset.row.id} className="relative flex">
                          <Pressable
                            onLongPress={editPreset}
                            onClick={() => {
                              setQuantifyValue(String(preset.value))
                              setQuantifyFreeform(false)
                            }}
                            className={`w-full rounded-[15px] py-[11px] text-center text-[13px] font-semibold ${
                              active ? 'text-white' : 'border border-line bg-surface text-ink-2'
                            }`}
                            style={active ? { background: look.accent } : undefined}
                          >
                            {preset.label}
                          </Pressable>
                          {editing && (
                            <span className="absolute -right-1 -top-1.5">
                              <EditDots onClick={editPreset} label={preset.label} />
                            </span>
                          )}
                        </span>
                      )
                    })}
                    {editing && (
                      <button
                        onClick={() => setOptionSheet({ kind: presetKind(kind), row: null })}
                        aria-label="New preset"
                        className="rounded-[15px] border border-dashed border-line-strong py-[11px] text-center text-[13px] font-semibold text-pine"
                      >
                        +
                      </button>
                    )}
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
                      : `Log to ${quantifyMealType ? mealInfo(quantifyMealType).label.toLowerCase() : 'the day'}`}
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
            <h2 className="text-lg font-bold text-ink">{editingRecipe ? 'Edit recipe' : variantOf ? 'New variant' : 'New recipe'}</h2>
            <button
              onClick={() => {
                setRecipeBuilderOpen(false)
                setEditingRecipe(null)
                setVariantOf(null)
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
              onChange={(e) => {
                setRecipeName(e.target.value)
                setVariantAutoName(false)
              }}
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

            {variantOf && (
              <div className="rounded-[20px] bg-cat-emerald-tint px-4 py-3 text-xs text-cat-emerald-ink">
                <p className="font-semibold">Variant of {variantOf.name}</p>
                <p className="mt-0.5">Tap an ingredient to swap it — the grams stay. Everything else is copied.</p>
              </div>
            )}

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
                {/* A variant's whole point is the difference — show the original beside it. */}
                {variantOf && builderPerServing && (
                  <p className="mt-1.5 border-t border-line pt-1.5 text-[11px] text-ink-muted">
                    {variantOf.name}: {round(recipeMacros(variantOf).kcal)} kcal · P {round(recipeMacros(variantOf).protein)} · C{' '}
                    {round(recipeMacros(variantOf).carbs)} · F {round(recipeMacros(variantOf).fat)} per serving
                  </p>
                )}
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
                    {row.replaces && (
                      <p className="text-[11px] font-semibold text-cat-emerald-ink">⇄ Swapped from {row.replaces}</p>
                    )}
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
                        {rowName ? (variantOf ? `${rowName}  ⇄` : rowName) : 'Choose ingredient…'}
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
                  <button onClick={() => runLsvSearch()} className="shrink-0 rounded-[20px] bg-pine px-4 py-2.5 font-semibold text-white">
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
                {ingredientCategories().map((c) => (
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

      {optionSheet?.kind === 'meal_type' && (
        <OptionSheet
          kind="meal_type"
          row={optionSheet.row}
          noun="meal"
          color="palette"
          newMeta={{ until_hour: 24 }}
          refs={MEAL_REFS}
          onChanged={load}
          onClose={() => setOptionSheet(null)}
          fields={(meta, set) => (
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              Default when logging before
              <input
                type="number"
                min={0}
                max={24}
                value={String(meta.until_hour ?? 24)}
                onChange={(e) => set({ until_hour: Math.min(24, Math.max(0, Number(e.target.value) || 0)) })}
                className="w-14 rounded-xl border border-line bg-page px-2 py-1.5 text-center text-sm font-semibold text-ink outline-none focus:border-pine"
              />
              :00
            </label>
          )}
        />
      )}
      {(optionSheet?.kind === 'serving_preset' || optionSheet?.kind === 'gram_preset') && (
        <OptionSheet
          kind={optionSheet.kind}
          row={optionSheet.row}
          noun="preset"
          noIcon
          maxLength={6}
          newMeta={{ value: optionSheet.kind === 'serving_preset' ? 1 : 100 }}
          onClose={() => setOptionSheet(null)}
          fields={(meta, set) => (
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              Amount
              <input
                type="number"
                min={0}
                step="any"
                value={String(meta.value ?? '')}
                onChange={(e) => set({ value: Number(e.target.value) || 0 })}
                className="w-20 rounded-xl border border-line bg-page px-2 py-1.5 text-center text-sm font-semibold text-ink outline-none focus:border-pine"
              />
              {optionSheet.kind === 'serving_preset' ? 'servings' : 'g'}
            </label>
          )}
        />
      )}
      {optionSheet?.kind === 'ingredient_category' && (
        <OptionSheet
          kind="ingredient_category"
          row={optionSheet.row}
          noun="category"
          color="hex"
          refs={CATEGORY_REFS}
          onRenamed={async (from, to) => {
            await renameCategory(from, to)
            if (libraryFilter === from) setLibraryFilter(to)
          }}
          onChanged={load}
          onClose={() => setOptionSheet(null)}
        />
      )}
    </Screen>
  )
}
