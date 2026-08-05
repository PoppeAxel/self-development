// Supabase Edge Function: checks reminders due in the current window and sends Web Push.
// Invoked every 15 minutes by pg_cron (see supabase/migrations/0002_cron.sql).
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET = Deno.env.get('CRON_SECRET')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:you@example.com'

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const now = new Date()
  const day = now.getUTCDay()
  // 15-minute window ending now, so a reminder fires once even if the cron run is a little late/early.
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000)
  const hhmm = (d: Date) => d.toISOString().slice(11, 16)

  const { data: reminders, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('enabled', true)
    .contains('days_of_week', [day])

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  const due = (reminders ?? []).filter((r) => {
    const t = r.time_of_day.slice(0, 5)
    return t >= hhmm(windowStart) && t <= hhmm(now)
  })

  let sent = 0
  for (const reminder of due) {
    const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('user_id', reminder.user_id)
    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          sub.subscription,
          JSON.stringify({ title: 'Self Development', body: reminder.label, url: '/' }),
        )
        sent++
      } catch (err) {
        // Subscription likely expired/revoked — clean it up.
        if (err instanceof Error && 'statusCode' in err && (err as { statusCode: number }).statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        }
      }
    }
    await supabase.from('reminders').update({ last_sent_at: now.toISOString() }).eq('id', reminder.id)
  }

  return new Response(JSON.stringify({ checked: reminders?.length ?? 0, due: due.length, sent }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
