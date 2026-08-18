import { supabase } from './supabase'

const STRAVA_CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID

export function connectStrava() {
  if (!STRAVA_CLIENT_ID) return
  const redirectUri = window.location.origin + window.location.pathname
  const url = new URL('https://www.strava.com/oauth/authorize')
  url.searchParams.set('client_id', STRAVA_CLIENT_ID)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('approval_prompt', 'auto')
  url.searchParams.set('scope', 'activity:read_all')
  window.location.href = url.toString()
}

export async function stravaConnected(): Promise<boolean> {
  const { data } = await supabase.from('strava_tokens').select('user_id').maybeSingle()
  return !!data
}

// Strava redirects back to this app with ?code=... after the user approves access.
// Exchanges it once via the strava-oauth-callback edge function, then strips the query
// string so a page refresh doesn't try to resubmit an already-used code.
export async function handleStravaOAuthRedirect(): Promise<{ handled: boolean; ok?: boolean; reason?: string }> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  if (!code) return { handled: false }

  window.history.replaceState({}, '', window.location.pathname)

  const { error } = await supabase.functions.invoke('strava-oauth-callback', { body: { code } })
  if (error) return { handled: true, ok: false, reason: error.message }
  return { handled: true, ok: true }
}
