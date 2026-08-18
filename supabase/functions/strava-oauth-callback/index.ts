// Supabase Edge Function: one-time OAuth handshake. Exchanges the authorization code
// Strava redirects back with for an access/refresh token pair and stores it in
// strava_tokens, so sync-strava-workouts can use it going forward.
//
// Unlike log-steps/send-reminders, this is called by the already-logged-in browser (see
// the "Connect Strava" flow in src/App.tsx), not an external unauthenticated caller — so
// it's deployed WITH Supabase's default JWT verification (no --no-verify-jwt, no shared
// ingest secret), and reads the calling user's id off that verified JWT.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const STRAVA_CLIENT_ID = Deno.env.get('STRAVA_CLIENT_ID')!
const STRAVA_CLIENT_SECRET = Deno.env.get('STRAVA_CLIENT_SECRET')!

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

  let body: { code?: string }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const code = body.code
  if (!code) {
    return new Response('Body must be { code: string }', { status: 400 })
  }

  const tokenRes = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenRes.ok) {
    return new Response(JSON.stringify({ error: await tokenRes.text() }), { status: 502 })
  }
  const tokenData = await tokenRes.json()

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { error } = await supabase.from('strava_tokens').upsert({
    user_id: user.id,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: new Date(tokenData.expires_at * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
})
