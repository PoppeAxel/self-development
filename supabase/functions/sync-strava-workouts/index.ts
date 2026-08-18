// Supabase Edge Function: pulls new Strava activities and upserts them into workouts.
// Invoked every 3 hours by pg_cron (see supabase/migrations/0013_strava_cron.sql).
// Refreshes the stored access token first since Strava's expire hourly and rotates the
// refresh token on every refresh — the new pair is written back to strava_tokens each run.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET = Deno.env.get('CRON_SECRET')!
const STRAVA_CLIENT_ID = Deno.env.get('STRAVA_CLIENT_ID')!
const STRAVA_CLIENT_SECRET = Deno.env.get('STRAVA_CLIENT_SECRET')!

interface StravaActivity {
  id: number
  name: string
  sport_type: string
  start_date_local: string
  moving_time: number
  distance: number
  calories?: number
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: tokenRow, error: tokenError } = await supabase.from('strava_tokens').select('*').maybeSingle()
  if (tokenError) {
    return new Response(JSON.stringify({ error: tokenError.message }), { status: 500 })
  }
  if (!tokenRow) {
    // Not connected yet — nothing to do, not an error.
    return new Response(JSON.stringify({ ok: true, skipped: 'not connected' }), { headers: { 'Content-Type': 'application/json' } })
  }

  let accessToken = tokenRow.access_token
  if (new Date(tokenRow.expires_at).getTime() <= Date.now() + 60_000) {
    const refreshRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        refresh_token: tokenRow.refresh_token,
        grant_type: 'refresh_token',
      }),
    })
    if (!refreshRes.ok) {
      return new Response(JSON.stringify({ error: await refreshRes.text() }), { status: 502 })
    }
    const refreshed = await refreshRes.json()
    accessToken = refreshed.access_token
    await supabase
      .from('strava_tokens')
      .update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', tokenRow.user_id)
  }

  // Cursor: sync anything newer than the latest workout already stored, or the last 14
  // days on a first run.
  const { data: latest } = await supabase
    .from('workouts')
    .select('date')
    .eq('user_id', tokenRow.user_id)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  const after = latest
    ? Math.floor(new Date(latest.date + 'T00:00:00Z').getTime() / 1000)
    : Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000)

  const activitiesRes = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!activitiesRes.ok) {
    return new Response(JSON.stringify({ error: await activitiesRes.text() }), { status: 502 })
  }
  const activities: StravaActivity[] = await activitiesRes.json()

  let synced = 0
  for (const a of activities) {
    const { error } = await supabase.from('workouts').upsert(
      {
        user_id: tokenRow.user_id,
        strava_id: a.id,
        sport_type: a.sport_type,
        name: a.name,
        date: a.start_date_local.slice(0, 10),
        duration_seconds: a.moving_time,
        distance_meters: a.distance,
        calories: a.calories ?? null,
      },
      { onConflict: 'user_id,strava_id' },
    )
    if (!error) synced++
  }

  return new Response(JSON.stringify({ ok: true, fetched: activities.length, synced }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
