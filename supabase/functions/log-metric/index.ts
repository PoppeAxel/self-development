// Supabase Edge Function: generalized ingestion for synced daily metrics (sleep hours now,
// calories/workouts later), from an iOS Shortcut reading Apple Health. Deliberately separate
// from send-reminders/log-steps — reuses the same auth pattern (a dedicated secret, since
// there's no user session on this request) but isn't tied to one metric name, so adding a
// new synced metric later doesn't mean writing another near-identical function.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const METRIC_INGEST_SECRET = Deno.env.get('METRIC_INGEST_SECRET')!

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${METRIC_INGEST_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: { metric?: string; date?: string; value?: number }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const { metric, date, value } = body
  if (
    !metric ||
    !date ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof value !== 'number' ||
    !Number.isFinite(value)
  ) {
    return new Response('Body must be { metric: string, date: "yyyy-MM-dd", value: number }', { status: 400 })
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

  // Same reasoning as log-steps: PostgREST's upsert can't target a partial unique index,
  // so this does an explicit find-then-update/insert instead.
  const { data: existing } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('user_id', userId)
    .eq('date', date)
    .eq('type', metric)
    .maybeSingle()

  const { error } = existing
    ? await supabase.from('journal_entries').update({ value_numeric: value }).eq('id', existing.id)
    : await supabase.from('journal_entries').insert({ user_id: userId, date, type: metric, value_numeric: value })

  if (error) {
    // Most likely cause: `metric` isn't an allowed journal_entries.type (check constraint).
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ ok: true, metric, date, value }), { headers: { 'Content-Type': 'application/json' } })
})
