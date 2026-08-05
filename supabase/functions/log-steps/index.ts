// Supabase Edge Function: ingests a daily step count (from an iOS Shortcut reading Apple
// Health, which Garmin Connect syncs into). No user session is available on this request
// (it's called by a Shortcut, not the app). This app is single-user, so rather than asking
// for a user id to store as a secret, the function just looks up "the only user" via the
// admin API each call.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const STEPS_INGEST_SECRET = Deno.env.get('STEPS_INGEST_SECRET')!

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${STEPS_INGEST_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: { date?: string; steps?: number }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const date = body.date
  const steps = body.steps
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof steps !== 'number' || !Number.isFinite(steps)) {
    return new Response('Body must be { date: "yyyy-MM-dd", steps: number }', { status: 400 })
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
  // does an explicit find-then-update/insert instead.
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

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ ok: true, date, steps }), { headers: { 'Content-Type': 'application/json' } })
})
