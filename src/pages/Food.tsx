import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/dates'
import { RefreshButton } from '../components/RefreshButton'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { BarcodeScanner } from '../components/BarcodeScanner'
import {
  addMacros,
  logEntryMacros,
  recipePerServingMacros,
  searchLivsmedelsverket,
  fetchLivsmedelsverketMacros,
  fetchOpenFoodFactsProduct,
  ZERO_MACROS,
  type Macros,
  type LivsmedelsverketFood,
} from '../lib/food'
import type { FoodLogEntry, Ingredient, Recipe, RecipeIngredient } from '../lib/types'

function round(n: number, decimals = 0) {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

function MacroRow({ macros }: { macros: Macros }) {
  return (
    <p className="text-sm text-gray-500">
      P {round(macros.protein)}g · C {round(macros.carbs)}g · F {round(macros.fat)}g · Fiber {round(macros.fiber)}g
    </p>
  )
}

interface RecipeIngredientRow {
  ingredientId: string
  name: string
  grams: string
}

interface IngredientFormState {
  name: string
  kcal: string
  protein: string
  carbs: string
  fat: string
  fiber: string
}

function emptyIngredientForm(): IngredientFormState {
  return { name: '', kcal: '', protein: '', carbs: '', fat: '', fiber: '' }
}

type FoodSubTab = 'log' | 'recipes' | 'library'
const SUB_TABS: FoodSubTab[] = ['log', 'recipes', 'library']
const SUB_TAB_LABELS: Record<FoodSubTab, string> = { log: 'Log', recipes: 'Recipes', library: 'Library' }

export function Food() {
  const [subTab, setSubTab] = useState<FoodSubTab>('log')
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [recipeLines, setRecipeLines] = useState<Map<string, RecipeIngredient[]>>(new Map())
  const [entries, setEntries] = useState<FoodLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const [logDate, setLogDate] = useState(todayISO())
  const [addLogOpen, setAddLogOpen] = useState(false)
  const [addLogQuery, setAddLogQuery] = useState('')
  const [quantifying, setQuantifying] = useState<{ kind: 'recipe' | 'ingredient'; id: string; name: string } | null>(null)
  const [quantifyValue, setQuantifyValue] = useState('')
  const [confirmDeleteEntry, setConfirmDeleteEntry] = useState<FoodLogEntry | null>(null)

  const [recipeBuilderOpen, setRecipeBuilderOpen] = useState(false)
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null)
  const [recipeName, setRecipeName] = useState('')
  const [recipeServings, setRecipeServings] = useState('1')
  const [recipeRows, setRecipeRows] = useState<RecipeIngredientRow[]>([])
  const [pickingIngredientFor, setPickingIngredientFor] = useState<number | 'new' | null>(null)
  const [ingredientPickQuery, setIngredientPickQuery] = useState('')
  const [confirmDeleteRecipe, setConfirmDeleteRecipe] = useState<Recipe | null>(null)

  const [ingredientFormOpen, setIngredientFormOpen] = useState(false)
  const [editingIngredient, setEditingIngredient] = useState<Ingredient | null>(null)
  const [ingredientForm, setIngredientForm] = useState<IngredientFormState>(emptyIngredientForm())
  const [ingredientFormMode, setIngredientFormMode] = useState<'manual' | 'search'>('manual')
  const [lsvQuery, setLsvQuery] = useState('')
  const [lsvResults, setLsvResults] = useState<LivsmedelsverketFood[]>([])
  const [lsvSearching, setLsvSearching] = useState(false)
  const [confirmDeleteIngredient, setConfirmDeleteIngredient] = useState<Ingredient | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanLookingUp, setScanLookingUp] = useState(false)
  const [scanLookupError, setScanLookupError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [{ data: ingredientRows }, { data: recipeRowsData }, { data: recipeLineRows }, { data: entryRows }] = await Promise.all([
      supabase.from('ingredients').select('*').order('name'),
      supabase.from('recipes').select('*').order('name'),
      supabase.from('recipe_ingredients').select('*').order('position'),
      supabase.from('food_log_entries').select('*').order('date', { ascending: false }).limit(300),
    ])
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

  function beginQuantify(kind: 'recipe' | 'ingredient', id: string, name: string) {
    setQuantifying({ kind, id, name })
    setQuantifyValue(kind === 'recipe' ? '1' : '100')
    setAddLogOpen(false)
  }

  async function confirmQuantify() {
    if (!quantifying) return
    const value = Number(quantifyValue)
    if (!quantifyValue || Number.isNaN(value) || value <= 0) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const payload =
      quantifying.kind === 'recipe'
        ? { recipe_id: quantifying.id, servings: value, ingredient_id: null, grams: null }
        : { ingredient_id: quantifying.id, grams: value, recipe_id: null, servings: null }
    await supabase.from('food_log_entries').insert({ ...payload, date: logDate, user_id: user.id })
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

  // Last 14 days of kcal totals, oldest first, for the trend chart.
  const kcalByDate = new Map<string, number>()
  for (const e of entries) {
    kcalByDate.set(e.date, (kcalByDate.get(e.date) ?? 0) + macrosFor(e).kcal)
  }
  const kcalSeries = [...kcalByDate.entries()]
    .map(([date, kcal]) => ({ date: date.slice(5), fullDate: date, value: round(kcal) }))
    .sort((a, b) => a.fullDate.localeCompare(b.fullDate))
    .slice(-14)

  const logSearchQuery = addLogQuery.trim().toLowerCase()
  const matchingRecipes = recipes.filter((r) => !logSearchQuery || r.name.toLowerCase().includes(logSearchQuery))
  const matchingIngredients = ingredients.filter((i) => !logSearchQuery || i.name.toLowerCase().includes(logSearchQuery))

  // --- Recipe builder ---

  function openNewRecipe() {
    setEditingRecipe(null)
    setRecipeName('')
    setRecipeServings('1')
    setRecipeRows([])
    setRecipeBuilderOpen(true)
  }

  function openEditRecipe(recipe: Recipe) {
    const lines = (recipeLines.get(recipe.id) ?? []).slice().sort((a, b) => a.position - b.position)
    setEditingRecipe(recipe)
    setRecipeName(recipe.name)
    setRecipeServings(String(recipe.servings))
    setRecipeRows(
      lines.map((l) => ({
        ingredientId: l.ingredient_id,
        name: ingredientsById.get(l.ingredient_id)?.name ?? 'Unknown ingredient',
        grams: String(l.grams),
      })),
    )
    setRecipeBuilderOpen(true)
  }

  function addIngredientToRecipe(ingredient: Ingredient) {
    if (pickingIngredientFor === 'new' || pickingIngredientFor === null) {
      setRecipeRows((rows) => [...rows, { ingredientId: ingredient.id, name: ingredient.name, grams: '100' }])
    } else {
      setRecipeRows((rows) =>
        rows.map((r, i) => (i === pickingIngredientFor ? { ...r, ingredientId: ingredient.id, name: ingredient.name } : r)),
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
      await supabase.from('recipes').update({ name, servings }).eq('id', editingRecipe.id)
      await supabase.from('recipe_ingredients').delete().eq('recipe_id', editingRecipe.id)
      recipeId = editingRecipe.id
    } else {
      const { data, error } = await supabase.from('recipes').insert({ name, servings, user_id: user.id }).select().single()
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

  function openNewIngredient() {
    setEditingIngredient(null)
    setIngredientForm(emptyIngredientForm())
    setIngredientFormMode('manual')
    setLsvQuery('')
    setLsvResults([])
    setScanLookupError(null)
    setScanLookingUp(false)
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
    })
    setIngredientFormMode('manual')
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
    setIngredientForm({
      name: food.namn,
      kcal: String(round(macros.kcal, 1)),
      protein: String(round(macros.protein, 1)),
      carbs: String(round(macros.carbs, 1)),
      fat: String(round(macros.fat, 1)),
      fiber: String(round(macros.fiber, 1)),
    })
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
    setIngredientForm({
      name: product.name,
      kcal: String(round(product.macros.kcal, 1)),
      protein: String(round(product.macros.protein, 1)),
      carbs: String(round(product.macros.carbs, 1)),
      fat: String(round(product.macros.fat, 1)),
      fiber: String(round(product.macros.fiber, 1)),
    })
    setIngredientFormMode('manual')
  }

  async function saveIngredientForm(e: React.FormEvent) {
    e.preventDefault()
    const name = ingredientForm.name.trim()
    const kcal = Number(ingredientForm.kcal)
    if (!name || Number.isNaN(kcal)) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const payload = {
      name,
      kcal_per_100g: kcal,
      protein_per_100g: Number(ingredientForm.protein) || 0,
      carbs_per_100g: Number(ingredientForm.carbs) || 0,
      fat_per_100g: Number(ingredientForm.fat) || 0,
      fiber_per_100g: Number(ingredientForm.fiber) || 0,
    }

    if (editingIngredient) {
      await supabase.from('ingredients').update(payload).eq('id', editingIngredient.id)
    } else {
      await supabase.from('ingredients').insert({ ...payload, source: 'manual', user_id: user.id })
    }

    setIngredientFormOpen(false)
    setEditingIngredient(null)
    load()
  }

  async function deleteIngredient(ingredient: Ingredient) {
    setIngredients((is) => is.filter((i) => i.id !== ingredient.id))
    await supabase.from('ingredients').delete().eq('id', ingredient.id)
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-6 pb-2">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Food</h1>
        <RefreshButton onRefresh={load} />
      </div>

      <div className="flex gap-2 rounded-2xl bg-gray-100 p-1">
        {SUB_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`flex-1 rounded-xl px-2 py-2 text-sm font-medium transition ${
              subTab === t ? 'bg-white text-teal-600 shadow-sm' : 'text-gray-500'
            }`}
          >
            {SUB_TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {subTab === 'log' && (
        <>
          <div className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white px-3 py-2 shadow-sm">
            <span className="text-sm font-medium text-gray-500">Log for</span>
            <input
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              type="date"
              className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-teal-400"
            />
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <p className="text-lg font-bold text-gray-900">{round(dayTotal.kcal)} kcal</p>
            <MacroRow macros={dayTotal} />
          </div>

          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : dayEntries.length === 0 ? (
            <p className="text-sm text-gray-400">Nothing logged for this day yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {dayEntries.map((entry) => {
                const m = macrosFor(entry)
                return (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm"
                  >
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{entryLabel(entry)}</p>
                      <p className="text-xs text-gray-400">
                        {round(m.kcal)} kcal · P {round(m.protein)}g C {round(m.carbs)}g F {round(m.fat)}g
                      </p>
                    </div>
                    <button onClick={() => setConfirmDeleteEntry(entry)} className="pl-3 text-gray-300" aria-label="Remove entry">
                      ✕
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <button
            onClick={openAddLog}
            className="rounded-2xl border-2 border-dashed border-gray-200 py-2.5 text-sm font-semibold text-teal-600"
          >
            + Add food
          </button>

          {kcalSeries.length > 1 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-gray-500">Daily calories</h2>
              <div className="h-40 rounded-3xl border border-gray-100 bg-white p-2 shadow-sm">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={kcalSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f0f7" />
                    <XAxis dataKey="date" stroke="#9ca3af" fontSize={11} />
                    <YAxis stroke="#9ca3af" fontSize={11} />
                    <Tooltip
                      contentStyle={{ background: '#fff', border: '1px solid #f1f0f7', fontSize: 12, borderRadius: 12 }}
                      formatter={(value) => [`${value} kcal`, 'Logged']}
                    />
                    <Bar dataKey="value" fill="#0d9488" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}

      {subTab === 'recipes' && (
        <>
          <button
            onClick={openNewRecipe}
            className="rounded-2xl border-2 border-dashed border-gray-200 py-2.5 text-sm font-semibold text-teal-600"
          >
            + New recipe
          </button>
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : recipes.length === 0 ? (
            <p className="text-sm text-gray-400">No recipes yet — add one above.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {recipes.map((recipe) => {
                const lines = recipeLines.get(recipe.id) ?? []
                const perServing = recipePerServingMacros(recipe, lines, ingredientsById)
                return (
                  <div
                    key={recipe.id}
                    className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm"
                  >
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{recipe.name}</p>
                      <p className="text-[11px] text-gray-400">
                        {round(perServing.kcal)} kcal/serving · {recipe.servings} serving{recipe.servings === 1 ? '' : 's'} ·{' '}
                        {lines.length} ingredient{lines.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <button onClick={() => openEditRecipe(recipe)} className="pl-3 text-gray-300" aria-label="Edit recipe">
                      ✎
                    </button>
                    <button onClick={() => setConfirmDeleteRecipe(recipe)} className="pl-3 text-gray-300" aria-label="Remove recipe">
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {subTab === 'library' && (
        <>
          <button
            onClick={openNewIngredient}
            className="rounded-2xl border-2 border-dashed border-gray-200 py-2.5 text-sm font-semibold text-teal-600"
          >
            + New ingredient
          </button>
          <p className="text-[11px] text-gray-400">Nutrition data via Livsmedelsverket's Livsmedelsdatabasen (CC BY 4.0).</p>
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : ingredients.length === 0 ? (
            <p className="text-sm text-gray-400">No ingredients yet — add one above.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {ingredients.map((ingredient) => (
                <div
                  key={ingredient.id}
                  className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm"
                >
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{ingredient.name}</p>
                    <p className="text-[11px] text-gray-400">
                      {ingredient.kcal_per_100g} kcal/100g
                      {ingredient.source === 'livsmedelsverket' ? ' · Livsmedelsverket' : ''}
                    </p>
                  </div>
                  <button onClick={() => openEditIngredient(ingredient)} className="pl-3 text-gray-300" aria-label="Edit ingredient">
                    ✎
                  </button>
                  <button
                    onClick={() => setConfirmDeleteIngredient(ingredient)}
                    className="pl-3 text-gray-300"
                    aria-label="Remove ingredient"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Add to log */}
      {addLogOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-gray-900">Add food</h2>
            <button onClick={() => setAddLogOpen(false)} className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600">
              Close ✕
            </button>
          </div>
          <div className="p-4">
            <input
              autoFocus
              value={addLogQuery}
              onChange={(e) => setAddLogQuery(e.target.value)}
              placeholder="Search recipes and ingredients"
              className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-teal-400"
            />
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {matchingRecipes.length > 0 && (
              <>
                <h3 className="mb-1 text-xs font-semibold uppercase text-gray-400">Recipes</h3>
                <div className="mb-3 flex flex-col gap-2">
                  {matchingRecipes.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => beginQuantify('recipe', r.id, r.name)}
                      className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white px-4 py-3 text-left shadow-sm"
                    >
                      <span className="font-medium text-gray-900">{r.name}</span>
                      <span className="text-xs text-gray-400">
                        {round(recipePerServingMacros(r, recipeLines.get(r.id) ?? [], ingredientsById).kcal)} kcal/serving
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {matchingIngredients.length > 0 && (
              <>
                <h3 className="mb-1 text-xs font-semibold uppercase text-gray-400">Ingredients</h3>
                <div className="flex flex-col gap-2">
                  {matchingIngredients.map((i) => (
                    <button
                      key={i.id}
                      onClick={() => beginQuantify('ingredient', i.id, i.name)}
                      className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white px-4 py-3 text-left shadow-sm"
                    >
                      <span className="font-medium text-gray-900">{i.name}</span>
                      <span className="text-xs text-gray-400">{i.kcal_per_100g} kcal/100g</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {matchingRecipes.length === 0 && matchingIngredients.length === 0 && (
              <p className="text-sm text-gray-400">No matches — add a new ingredient or recipe from the Recipes/Library tabs first.</p>
            )}
          </div>
        </div>
      )}

      {quantifying && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={() => setQuantifying(null)}>
          <div className="w-full max-w-xs rounded-3xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold text-gray-900">{quantifying.name}</p>
            <p className="mt-1 text-sm text-gray-500">{quantifying.kind === 'recipe' ? 'How many servings?' : 'How many grams?'}</p>
            <input
              autoFocus
              value={quantifyValue}
              onChange={(e) => setQuantifyValue(e.target.value)}
              type="number"
              step={quantifying.kind === 'recipe' ? '0.5' : '1'}
              className="mt-3 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 outline-none focus:border-teal-400"
            />
            <div className="mt-4 flex gap-2">
              <button onClick={() => setQuantifying(null)} className="flex-1 rounded-2xl bg-gray-100 px-4 py-2.5 font-medium text-gray-600">
                Cancel
              </button>
              <button onClick={confirmQuantify} className="flex-1 rounded-2xl bg-teal-600 px-4 py-2.5 font-semibold text-white">
                Log
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recipe builder */}
      {recipeBuilderOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-gray-900">{editingRecipe ? 'Edit recipe' : 'New recipe'}</h2>
            <button
              onClick={() => {
                setRecipeBuilderOpen(false)
                setEditingRecipe(null)
              }}
              className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600"
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
              className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-teal-400"
            />
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Makes</span>
              <input
                value={recipeServings}
                onChange={(e) => setRecipeServings(e.target.value)}
                type="number"
                step="0.5"
                className="w-20 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-center text-gray-900 outline-none focus:border-teal-400"
              />
              <span className="text-sm text-gray-500">servings</span>
            </div>

            <div className="flex flex-col gap-2">
              {recipeRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2 rounded-2xl border border-gray-100 p-3">
                  <button
                    type="button"
                    onClick={() => {
                      setPickingIngredientFor(i)
                      setIngredientPickQuery('')
                    }}
                    className="min-w-0 flex-1 text-left font-medium text-gray-900"
                  >
                    {row.name || 'Choose ingredient…'}
                  </button>
                  <input
                    value={row.grams}
                    onChange={(e) => setRecipeRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, grams: e.target.value } : r)))}
                    type="number"
                    placeholder="g"
                    className="w-16 min-w-0 rounded-xl border border-gray-200 bg-white px-2 py-2 text-center text-gray-900 outline-none focus:border-teal-400"
                  />
                  <button
                    type="button"
                    onClick={() => setRecipeRows((rows) => rows.filter((_, idx) => idx !== i))}
                    className="shrink-0 px-1 text-gray-300"
                    aria-label="Remove ingredient"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setPickingIngredientFor('new')
                setIngredientPickQuery('')
              }}
              className="rounded-2xl border-2 border-dashed border-gray-200 py-2 text-sm font-semibold text-teal-600"
            >
              + Add ingredient
            </button>
            <button type="submit" className="mt-2 rounded-2xl bg-teal-600 px-4 py-2.5 font-semibold text-white">
              {editingRecipe ? 'Save changes' : 'Save recipe'}
            </button>
          </form>

          {pickingIngredientFor !== null && (
            <div className="fixed inset-0 z-[60] flex flex-col bg-white safe-top safe-bottom">
              <div className="flex items-center justify-between px-4 pt-4">
                <h2 className="text-lg font-bold text-gray-900">Choose ingredient</h2>
                <button
                  onClick={() => setPickingIngredientFor(null)}
                  className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600"
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
                  className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-teal-400"
                />
              </div>
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                {(() => {
                  const q = ingredientPickQuery.trim().toLowerCase()
                  const candidates = ingredients.filter((i) => !q || i.name.toLowerCase().includes(q))
                  return (
                    <div className="flex flex-col gap-2">
                      {candidates.length === 0 && (
                        <p className="text-sm text-gray-400">
                          No matches — close this and add it to your ingredient library first (Library tab: manual entry or
                          Livsmedelsverket search).
                        </p>
                      )}
                      {candidates.map((ing) => (
                        <button
                          key={ing.id}
                          type="button"
                          onClick={() => addIngredientToRecipe(ing)}
                          className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white px-4 py-3 text-left shadow-sm"
                        >
                          <span className="font-medium text-gray-900">{ing.name}</span>
                          <span className="text-xs text-gray-400">{ing.kcal_per_100g} kcal/100g</span>
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

      {/* Ingredient form (manual entry or import from Livsmedelsverket) */}
      {ingredientFormOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-gray-900">{editingIngredient ? 'Edit ingredient' : 'New ingredient'}</h2>
            <button
              onClick={() => setIngredientFormOpen(false)}
              className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600"
            >
              Close ✕
            </button>
          </div>

          <div className="flex gap-2 px-4 pt-3">
            <div className="flex flex-1 gap-2 rounded-2xl bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setIngredientFormMode('manual')}
                className={`flex-1 rounded-xl px-2 py-2 text-sm font-medium transition ${
                  ingredientFormMode === 'manual' ? 'bg-white text-teal-600 shadow-sm' : 'text-gray-500'
                }`}
              >
                Manual entry
              </button>
              <button
                type="button"
                onClick={() => setIngredientFormMode('search')}
                className={`flex-1 rounded-xl px-2 py-2 text-sm font-medium transition ${
                  ingredientFormMode === 'search' ? 'bg-white text-teal-600 shadow-sm' : 'text-gray-500'
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
              className="w-full rounded-2xl border-2 border-dashed border-gray-200 py-2 text-sm font-semibold text-teal-600"
            >
              📷 Scan barcode
            </button>
            {scanLookingUp && <p className="mt-2 text-xs text-gray-400">Looking up barcode…</p>}
            {scanLookupError && <p className="mt-2 text-xs text-red-500">{scanLookupError}</p>}
          </div>

          {/* Single scrollable region for both the search results and the form below —
              they used to be separate blocks with only the form scrollable, which made
              search results past the fold unreachable (nothing to scroll them into view). */}
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
            {ingredientFormMode === 'search' && (
              <div className="flex flex-col gap-2 border-b border-gray-100 pb-4">
                <div className="flex gap-2">
                  <input
                    value={lsvQuery}
                    onChange={(e) => setLsvQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && runLsvSearch()}
                    placeholder="e.g. kycklingfilé"
                    className="min-w-0 flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-teal-400"
                  />
                  <button onClick={runLsvSearch} className="shrink-0 rounded-2xl bg-teal-600 px-4 py-2.5 font-semibold text-white">
                    Search
                  </button>
                </div>
                {lsvSearching && <p className="text-sm text-gray-400">Searching…</p>}
                {!lsvSearching && lsvResults.length === 0 && lsvQuery && (
                  <p className="text-sm text-gray-400">No matches — try a different search term, or switch to manual entry.</p>
                )}
                <div className="flex flex-col gap-2">
                  {lsvResults.map((f) => (
                    <button
                      key={f.nummer}
                      onClick={async () => {
                        await importLsvFood(f)
                      }}
                      className="rounded-2xl border border-gray-100 bg-white px-4 py-3 text-left text-sm font-medium text-gray-900 shadow-sm"
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
              className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-teal-400"
            />
            <p className="text-xs text-gray-400">Per 100g:</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
                Calories (kcal)
                <input
                  value={ingredientForm.kcal}
                  onChange={(e) => setIngredientForm((f) => ({ ...f, kcal: e.target.value }))}
                  type="number"
                  placeholder="0"
                  className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-teal-400"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
                Protein (g)
                <input
                  value={ingredientForm.protein}
                  onChange={(e) => setIngredientForm((f) => ({ ...f, protein: e.target.value }))}
                  type="number"
                  placeholder="0"
                  className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-teal-400"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
                Carbs (g)
                <input
                  value={ingredientForm.carbs}
                  onChange={(e) => setIngredientForm((f) => ({ ...f, carbs: e.target.value }))}
                  type="number"
                  placeholder="0"
                  className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-teal-400"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
                Fat (g)
                <input
                  value={ingredientForm.fat}
                  onChange={(e) => setIngredientForm((f) => ({ ...f, fat: e.target.value }))}
                  type="number"
                  placeholder="0"
                  className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-teal-400"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
                Fiber (g)
                <input
                  value={ingredientForm.fiber}
                  onChange={(e) => setIngredientForm((f) => ({ ...f, fiber: e.target.value }))}
                  type="number"
                  placeholder="0"
                  className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-teal-400"
                />
              </label>
            </div>
            <button type="submit" className="mt-2 rounded-2xl bg-teal-600 px-4 py-2.5 font-semibold text-white">
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
    </div>
  )
}
