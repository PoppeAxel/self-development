// Supabase Edge Function: fetch a recipe URL and return its structured contents.
//
// This exists purely because of CORS. The app calls Livsmedelsverket and Open Food Facts
// straight from the browser since both reflect any Origin, but arbitrary recipe sites
// don't — so the fetch has to happen server-side.
//
// Like strava-oauth-callback (and unlike log-steps/send-reminders), this is called by the
// already-logged-in browser via supabase.functions.invoke, so it's deployed WITH
// Supabase's default JWT verification — no --no-verify-jwt, no shared ingest secret.
//
// Parsing is schema.org Recipe JSON-LD only. Practically every recipe site publishes it
// because Google's rich results need it, and it's structured data rather than a guess at
// someone's markup. A site without it fails cleanly instead of returning junk the user
// then has to notice is wrong.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

interface ParsedRecipe {
  name: string
  servings: number | null
  ingredientLines: string[]
  /** The site's own per-serving figures, when it publishes them. Shown as a cross-check
      against what the app computes — never stored, since recipes hold no macro columns. */
  statedNutrition: { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null } | null
  sourceUrl: string
  imageUrl: string | null
}

// Server-side fetch of a user-supplied URL: keep it to public http(s) and refuse the
// obvious ways to point it back at internal infrastructure.
function isSafeUrl(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return null
  }
  return url
}

/** Every JSON-LD blob on the page, flattened through @graph and arrays. */
function collectJsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = []
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null
  while ((match = scriptRe.exec(html)) !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(match[1].trim())
    } catch {
      continue // One malformed block shouldn't sink the others.
    }
    const queue = [parsed]
    while (queue.length > 0) {
      const node = queue.shift()
      if (Array.isArray(node)) {
        queue.push(...node)
      } else if (node && typeof node === 'object') {
        const record = node as Record<string, unknown>
        nodes.push(record)
        if (Array.isArray(record['@graph'])) queue.push(...(record['@graph'] as unknown[]))
      }
    }
  }
  return nodes
}

function hasRecipeType(node: Record<string, unknown>): boolean {
  const type = node['@type']
  if (typeof type === 'string') return type.toLowerCase() === 'recipe'
  if (Array.isArray(type)) return type.some((t) => typeof t === 'string' && t.toLowerCase() === 'recipe')
  return false
}

/** schema.org allows a bare string, an object with `name`, or an array of either. */
function firstString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item)
      if (found) return found
    }
    return null
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return firstString(record.name ?? record.url ?? record['@value'])
  }
  return null
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

function cleanLine(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** "4 portioner" / "Serves 4" / 4 → 4. Null when the site says nothing usable. */
function parseServings(value: unknown): number | null {
  const text = firstString(value)
  if (!text) return null
  const match = text.match(/\d+([.,]\d+)?/)
  if (!match) return null
  const parsed = Number(match[0].replace(',', '.'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** "512 kcal", "23 g", "23.4" → number. schema.org nutrition values are strings-with-units. */
function parseNutrientNumber(value: unknown): number | null {
  const text = firstString(value)
  if (!text) return null
  const match = text.match(/\d+([.,]\d+)?/)
  if (!match) return null
  const parsed = Number(match[0].replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function parseRecipeNode(node: Record<string, unknown>, sourceUrl: string): ParsedRecipe | null {
  const name = firstString(node.name)
  const rawIngredients = node.recipeIngredient ?? node.ingredients
  if (!name || !Array.isArray(rawIngredients)) return null

  const ingredientLines = rawIngredients
    .map((line) => (typeof line === 'string' ? cleanLine(line) : ''))
    .filter((line) => line.length > 0)
  if (ingredientLines.length === 0) return null

  let statedNutrition: ParsedRecipe['statedNutrition'] = null
  const nutrition = node.nutrition
  if (nutrition && typeof nutrition === 'object') {
    const n = nutrition as Record<string, unknown>
    const kcal = parseNutrientNumber(n.calories)
    const protein = parseNutrientNumber(n.proteinContent)
    const carbs = parseNutrientNumber(n.carbohydrateContent)
    const fat = parseNutrientNumber(n.fatContent)
    if (kcal != null || protein != null || carbs != null || fat != null) {
      statedNutrition = { kcal, protein, carbs, fat }
    }
  }

  return {
    name: cleanLine(name),
    servings: parseServings(node.recipeYield),
    ingredientLines,
    statedNutrition,
    sourceUrl,
    imageUrl: firstString(node.image),
  }
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer /, '')
  const authedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const {
    data: { user },
    error: authError,
  } = await authedClient.auth.getUser(jwt)
  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: { url?: string }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const target = body.url ? isSafeUrl(body.url.trim()) : null
  if (!target) {
    return new Response(JSON.stringify({ error: "That doesn't look like a public recipe link." }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let html: string
  try {
    const res = await fetch(target.toString(), {
      redirect: 'follow',
      headers: {
        // Plenty of sites serve a stripped page (or a block) to an unrecognised agent.
        'User-Agent': 'Mozilla/5.0 (compatible; SelfDevRecipeImport/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `The site returned ${res.status}.` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    html = await res.text()
  } catch {
    return new Response(JSON.stringify({ error: "Couldn't reach that page." }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const recipeNode = collectJsonLdNodes(html).find(hasRecipeType)
  const parsed = recipeNode ? parseRecipeNode(recipeNode, target.toString()) : null
  if (!parsed) {
    return new Response(
      JSON.stringify({
        error: "That page doesn't publish a recipe in a format this can read — add it manually instead.",
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  return new Response(JSON.stringify(parsed), { headers: { 'Content-Type': 'application/json' } })
})
