import type { Ingredient } from './types'

// Turning a recipe site's ingredient lines into rows this app can compute macros from.
// The edge function (supabase/functions/import-recipe) does the fetching and JSON-LD
// parsing; everything here is pure, so the awkward part — reading "2 msk olivolja" — is
// testable without a network call.

export interface ImportedRecipe {
  name: string
  servings: number | null
  ingredientLines: string[]
  statedNutrition: { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null } | null
  sourceUrl: string
  imageUrl: string | null
}

/** Units that convert to grams on their own, with no knowledge of the ingredient. */
const MASS_UNITS: Record<string, number> = {
  g: 1,
  gr: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  hg: 100,
  ounce: 28.35,
  oz: 28.35,
  lb: 453.6,
}

/**
 * Volume units, in millilitres. These only become grams once we know what's being
 * measured — a dl of flour and a dl of oil are different weights — so a line using one
 * stays unresolved unless the matched ingredient carries a `portion_label` that matches.
 */
const VOLUME_UNITS: Record<string, number> = {
  ml: 1,
  cl: 10,
  dl: 100,
  l: 1000,
  liter: 1000,
  msk: 15,
  tsk: 5,
  krm: 1,
  tbsp: 15,
  tsp: 5,
  cup: 240,
}

/** Counted units — "2 st", "1 klyfta". Only resolvable via the ingredient's own portion. */
const COUNT_UNITS = new Set(['st', 'stycken', 'styck', 'klyfta', 'klyftor', 'burk', 'burkar', 'paket', 'pkt', 'näve', 'nypa'])

const UNIT_ALIASES: Record<string, string> = {
  matsked: 'msk',
  matskedar: 'msk',
  tesked: 'tsk',
  teskedar: 'tsk',
  kryddmått: 'krm',
  deciliter: 'dl',
  centiliter: 'cl',
  milliliter: 'ml',
  gram: 'g',
  kilogram: 'kg',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  cups: 'cup',
  pounds: 'lb',
  ounces: 'oz',
}

const VULGAR_FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 0.25,
  '¾': 0.75,
  '⅛': 0.125,
}

export type ParsedUnit = { kind: 'mass'; grams: number } | { kind: 'volume'; ml: number; unit: string } | { kind: 'count'; unit: string } | { kind: 'none' }

export interface ParsedLine {
  /** The original text, always kept so an unresolved line can still be read. */
  raw: string
  quantity: number | null
  unit: ParsedUnit
  /** What's left after the quantity and unit — what we search the library for. */
  name: string
}

function parseQuantity(token: string): number | null {
  // "1½", "½", "1 1/2", "1/2", "1,5", "1.5"
  let total = 0
  let matched = false

  const vulgarMatch = token.match(/[½⅓⅔¼¾⅛]/)
  if (vulgarMatch) {
    total += VULGAR_FRACTIONS[vulgarMatch[0]]
    matched = true
    token = token.replace(vulgarMatch[0], '')
  }

  const fraction = token.match(/^(\d+)\/(\d+)$/)
  if (fraction) {
    const denominator = Number(fraction[2])
    if (denominator === 0) return null
    return total + Number(fraction[1]) / denominator
  }

  const plain = token.replace(',', '.').match(/^\d+(\.\d+)?/)
  if (plain) {
    total += Number(plain[0])
    matched = true
  }

  return matched ? total : null
}

/**
 * Splits an ingredient line into quantity, unit and name. Handles the shapes recipe sites
 * actually use — "200 g kycklingfilé", "2 msk olivolja", "1½ dl grädde", "2 st ägg",
 * "salt och peppar" (no quantity at all), and a trailing parenthetical note.
 */
export function parseIngredientLine(raw: string): ParsedLine {
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  // A leading range ("2-3 msk") takes the lower bound — better to under-count than to
  // silently inflate a recipe's macros. Re-split on runs of whitespace, since dropping the
  // upper bound leaves a gap that would otherwise become an empty token in the unit slot.
  const tokens = cleaned
    .replace(/(\d)\s*[-–]\s*(\d)/g, '$1 ')
    .trim()
    .split(/\s+/)

  let index = 0
  let quantity: number | null = null

  // Quantities can span two tokens ("1 1/2 dl").
  const first = tokens[index] ? parseQuantity(tokens[index]) : null
  if (first != null) {
    quantity = first
    index += 1
    const second = tokens[index] ? parseQuantity(tokens[index]) : null
    if (second != null && second < 1 && tokens[index].includes('/')) {
      quantity += second
      index += 1
    }
  }

  let unit: ParsedUnit = { kind: 'none' }
  const unitToken = tokens[index]?.toLowerCase().replace(/\.$/, '')
  if (unitToken) {
    const normalised = UNIT_ALIASES[unitToken] ?? unitToken
    if (MASS_UNITS[normalised] != null) {
      unit = { kind: 'mass', grams: MASS_UNITS[normalised] }
      index += 1
    } else if (VOLUME_UNITS[normalised] != null) {
      unit = { kind: 'volume', ml: VOLUME_UNITS[normalised], unit: normalised }
      index += 1
    } else if (COUNT_UNITS.has(normalised)) {
      unit = { kind: 'count', unit: normalised }
      index += 1
    }
  }

  const name = tokens
    .slice(index)
    .join(' ')
    // Drop parenthetical notes and anything after a comma — "lök, finhackad" is still lök.
    .replace(/\([^)]*\)/g, '')
    .split(',')[0]
    .replace(/\s+/g, ' ')
    .trim()

  return { raw: cleaned, quantity, unit, name: name || cleaned }
}

// --- Matching a line to the library ---
//
// `matchesSearch` is deliberately generous because a human reads the results and picks.
// Auto-matching can't be: it matched "ägg" to "Ägg nudlar", "olja" to "Sesamolja" and
// "kycklingfilé" to "Kycklinglårfile" (breast vs thigh — a real macro difference). A wrong
// auto-match silently produces wrong macros, which is worse than no match, so nothing is
// filled in unless the names genuinely denote the same food. Everything else is offered as
// a suggestion to tap.

/** Words that describe packaging, form or provenance rather than what the food is. */
const INCIDENTAL_WORDS = new Set([
  'pa', 'burk', 'burkar', 'i', 'saltlake', 'fryst', 'frysta', 'frysvara', 'fryspase',
  'farsk', 'farska', 'ra', 'rat', 'konserverad', 'ekologisk', 'eko', 'svensk', 'svenska',
  'hel', 'hela', 'hackad', 'hackade', 'riven', 'rivet', 'skivad', 'skivat', 'mald', 'malen',
  'torkad', 'torkat', 'med', 'och', 'skal', 'm', 'utan', 'forpackad', 'kyld', 'naturell',
  'fresh', 'frozen', 'raw', 'whole', 'chopped', 'grated', 'sliced', 'dried', 'canned',
  'organic', 'the', 'and', 'of', 'in',
])

function foldDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function normaliseName(name: string): string {
  return foldDiacritics(name.toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normalised tokens with the incidental words removed — what the food actually is. */
function coreTokens(name: string): string[] {
  return normaliseName(name)
    .split(' ')
    .filter((token) => token.length > 0 && !INCIDENTAL_WORDS.has(token))
}

/**
 * Same food? True only when the two names reduce to the same set of meaningful words.
 * "majs" == "Majs på burk" (packaging stripped) but "ägg" != "Ägg nudlar" ("nudlar" is
 * a real word that changes the food), which is the distinction that matters here.
 */
function denotesSameFood(a: string, b: string): boolean {
  const left = coreTokens(a)
  const right = coreTokens(b)
  if (left.length === 0 || right.length === 0) return false
  if (left.length !== right.length) return false
  const sorted = (tokens: string[]) => [...tokens].sort().join(' ')
  return sorted(left) === sorted(right)
}

/**
 * How plausible a candidate is, for ordering suggestions only — never for deciding to
 * fill a row in. Shared whole words count; a word merely *containing* the query (the
 * "olja" in "sesamolja") counts for much less, since that's exactly the trap.
 */
function suggestionScore(query: string, candidate: string): number {
  const queryTokens = coreTokens(query)
  const candidateTokens = coreTokens(candidate)
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0

  // Swedish compounds mean near-misses often share a long prefix ("kycklingfilé" /
  // "kycklinglårfile"). Worth offering; safe to score, since the traps this replaced
  // ("olja" inside "sesamolja") share no prefix at all.
  const sharedPrefix = (a: string, b: string): number => {
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1
    return i
  }

  let score = 0
  for (const token of queryTokens) {
    if (candidateTokens.includes(token)) score += 1
    else if (candidateTokens.some((c) => c.startsWith(token) || token.startsWith(c))) score += 0.5
    else if (candidateTokens.some((c) => sharedPrefix(c, token) >= 5)) score += 0.4
    else if (candidateTokens.some((c) => c.includes(token))) score += 0.2
  }
  // Normalise by the longer side so a long candidate name with one shared word doesn't
  // outrank a short, near-identical one.
  return score / Math.max(queryTokens.length, candidateTokens.length)
}

const SUGGESTION_FLOOR = 0.3
const MAX_SUGGESTIONS = 3

export interface ResolvedLine extends ParsedLine {
  /** Library match, set ONLY when the names denote the same food. Never a guess. */
  match: Ingredient | null
  /** Ranked alternatives to offer when nothing was confident enough to fill in. */
  suggestions: Ingredient[]
  /** Grams to log, when it could be worked out. Null means the user has to say. */
  grams: number | null
  /** Why grams couldn't be derived — shown next to the line so the ask makes sense. */
  reason: 'ok' | 'no-match' | 'needs-grams'
}

/**
 * Converts one line to grams where possible. Mass units convert outright; volume and
 * count units only do so when the matched ingredient has a portion whose label matches
 * the unit (the "1 msk = 15g" the ingredient form already stores).
 */
export function resolveLine(line: ParsedLine, library: Ingredient[]): ResolvedLine {
  // Only names denoting the same food fill a row in. Shortest wins among those, so "200 g
  // lax" takes "Lax" over "Lax odlad Norge fjordlax rå förpackad".
  const match = line.name
    ? (library.filter((i) => denotesSameFood(i.name, line.name)).sort((a, b) => a.name.length - b.name.length)[0] ?? null)
    : null

  if (!match) {
    const suggestions = line.name
      ? library
          .map((ingredient) => ({ ingredient, score: suggestionScore(line.name, ingredient.name) }))
          .filter((row) => row.score >= SUGGESTION_FLOOR)
          .sort((a, b) => b.score - a.score || a.ingredient.name.length - b.ingredient.name.length)
          .slice(0, MAX_SUGGESTIONS)
          .map((row) => row.ingredient)
      : []
    return { ...line, match: null, suggestions, grams: null, reason: 'no-match' }
  }

  if (line.quantity != null && line.unit.kind === 'mass') {
    return { ...line, match, suggestions: [], grams: line.quantity * line.unit.grams, reason: 'ok' }
  }

  if (line.quantity != null && (line.unit.kind === 'volume' || line.unit.kind === 'count')) {
    const label = match.portion_label?.toLowerCase().trim()
    const unitName = line.unit.kind === 'volume' ? line.unit.unit : line.unit.unit
    if (label && match.portion_grams && (label === unitName || UNIT_ALIASES[label] === unitName)) {
      return { ...line, match, suggestions: [], grams: line.quantity * match.portion_grams, reason: 'ok' }
    }
    return { ...line, match, suggestions: [], grams: null, reason: 'needs-grams' }
  }

  // No unit at all ("2 ägg") — a portion is the only way to know what that weighs.
  if (line.quantity != null && match.portion_grams) {
    return { ...line, match, suggestions: [], grams: line.quantity * match.portion_grams, reason: 'ok' }
  }

  return { ...line, match, suggestions: [], grams: null, reason: 'needs-grams' }
}

export function resolveImportedLines(lines: string[], library: Ingredient[]): ResolvedLine[] {
  return lines.map((line) => resolveLine(parseIngredientLine(line), library))
}
