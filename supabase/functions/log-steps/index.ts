// Supabase Edge Function: ingests one or more daily step counts (from an iOS Shortcut
// reading Apple Health, which Garmin Connect syncs into). No user session is available on
// this request (it's called by a Shortcut, not the app). This app is single-user, so
// rather than asking for a user id to store as a secret, the function just looks up "the
// only user" via the admin API each call.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const STEPS_INGEST_SECRET = Deno.env.get('STEPS_INGEST_SECRET')!

interface Entry {
  date: string
  steps: number
}

function isValidEntry(e: unknown): e is Entry {
  if (typeof e !== 'object' || e === null) return false
  const { date, steps } = e as { date?: unknown; steps?: unknown }
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof steps === 'number' && Number.isFinite(steps)
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${STEPS_INGEST_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  // Two accepted shapes: a single { date, steps } (the original, still used by older
  // Shortcut versions), or { entries: [{ date, steps }, ...] } — lets one automation run
  // re-send today plus a trailing window of recent days in one call, so a day whose Garmin
  // sync was still incomplete when it first ran gets silently corrected on a later run
  // instead of needing a manual fix in the app.
  const entries: Entry[] = isValidEntry(body)
    ? [body]
    : typeof body === 'object' && body !== null && Array.isArray((body as { entries?: unknown }).entries)
      ? (body as { entries: unknown[] }).entries.filter(isValidEntry)
      : []

  if (entries.length === 0) {
    return new Response('Body must be { date, steps } or { entries: [{ date, steps }, ...] }', { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const {
    data: { users },
    error: userError,
  } = await supabase.auth.admin.listUsers()
  if (userError || users.length === 0) {
    return new Response(JSON.stringify({ error: userError?.message ?? 'No user found' }), { status: 500 })
  }
  const userId = users[0].id

  // PostgREST's upsert issues a plain ON CONFLICT (columns) with no WHERE clause, which
  // can't target the partial unique index (type = 'steps') from the migration — so this
  // does an explicit find-then-update/insert instead, one per entry (each keyed by a
  // distinct date, so these are safe to run concurrently).
  const results = await Promise.all(
    entries.map(async ({ date, steps }) => {
      const { data: existing } = await supabase
        .from('journal_entries')
        .select('id')
        .eq('user_id', userId)
        .eq('date', date)
        .eq('type', 'steps')
        .maybeSingle()

      const { error } = existing
        ? await supabase.from('journal_entries').update({ value_numeric: steps }).eq('id', existing.id)
        : await supabase.from('journal_entries').insert({ user_id: userId, date, type: 'steps', value_numeric: steps })

      return { date, steps, error: error?.message ?? null }
    }),
  )

  const anyError = results.some((r) => r.error)
  return new Response(JSON.stringify({ ok: !anyError, results }), {
    status: anyError ? 500 : 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
