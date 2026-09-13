import { matchesSearch } from './food'
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

export interface ResolvedLine extends ParsedLine {
  /** Best library match, or null when nothing looked close enough. */
  match: Ingredient | null
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
  // matchesSearch is the same fuzzy matcher the Food search uses — diacritic-insensitive,
  // word-order independent, with the within-word split that bridges "kycklingfile" to
  // "Kyckling bröstfilé".
  const candidates = line.name ? library.filter((i) => matchesSearch(i.name, line.name)) : []
  // Shortest name wins: "Lax" beats "Lax odlad Norge fjordlax rå förpackad" for the line
  // "200 g lax", and a more specific line matches the more specific row anyway.
  const match = candidates.sort((a, b) => a.name.length - b.name.length)[0] ?? null

  if (!match) return { ...line, match: null, grams: null, reason: 'no-match' }

  if (line.quantity != null && line.unit.kind === 'mass') {
    return { ...line, match, grams: line.quantity * line.unit.grams, reason: 'ok' }
  }

  if (line.quantity != null && (line.unit.kind === 'volume' || line.unit.kind === 'count')) {
    const label = match.portion_label?.toLowerCase().trim()
    const unitName = line.unit.kind === 'volume' ? line.unit.unit : line.unit.unit
    if (label && match.portion_grams && (label === unitName || UNIT_ALIASES[label] === unitName)) {
      return { ...line, match, grams: line.quantity * match.portion_grams, reason: 'ok' }
    }
    return { ...line, match, grams: null, reason: 'needs-grams' }
  }

  // No unit at all ("2 ägg") — a portion is the only way to know what that weighs.
  if (line.quantity != null && match.portion_grams) {
    return { ...line, match, grams: line.quantity * match.portion_grams, reason: 'ok' }
  }

  return { ...line, match, grams: null, reason: 'needs-grams' }
}

export function resolveImportedLines(lines: string[], library: Ingredient[]): ResolvedLine[] {
  return lines.map((line) => resolveLine(parseIngredientLine(line), library))
}
