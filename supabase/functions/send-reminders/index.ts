// Supabase Edge Function: checks reminders due in the current window and sends Web Push.
// Invoked every 15 minutes by pg_cron (see supabase/migrations/0002_cron.sql).
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'
import { isDue, localParts } from './localTime.ts'

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

  const { data: reminders, error } = await supabase.from('reminders').select('*').eq('enabled', true)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  // time_of_day/days_of_week are local to each reminder's timezone (0036), so "now" is
  // worked out per zone — that's what keeps 22:00 at 22:00 across summer/winter time.
  const due = []
  for (const reminder of reminders ?? []) {
    const local = localParts(now, reminder.timezone)
    if (!isDue(reminder.time_of_day, reminder.days_of_week, local)) continue
    // Task/check-in completions are stored under the local date.
    const today = local.date
    // A reminder tied to a task only fires if that task hasn't been completed yet today.
    if (reminder.task_id) {
      const { data: completion } = await supabase
        .from('task_completions')
        .select('id')
        .eq('task_id', reminder.task_id)
        .eq('date', today)
        .maybeSingle()
      if (completion) continue
    }
    // The daily check-in nudge only fires if tonight's check-in isn't saved yet.
    if (reminder.kind === 'checkin') {
      const { data: checkin } = await supabase
        .from('daily_checkins')
        .select('id')
        .eq('user_id', reminder.user_id)
        .eq('date', today)
        .maybeSingle()
      if (checkin) continue
    }
    due.push(reminder)
  }

  let sent = 0
  for (const reminder of due) {
    const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('user_id', reminder.user_id)
    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          sub.subscription,
          JSON.stringify({ title: 'Self Development', body: reminder.label, url: reminder.kind === 'checkin' ? '/?checkin=1' : '/' }),
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
