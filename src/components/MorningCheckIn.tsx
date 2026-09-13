import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/dates'

const STORAGE_KEY = 'morning-checkin-last-shown'

// Nudges the two metrics that don't sync automatically — weight and sleep — once per day
// so they don't get forgotten before the day gets going. Steps/cardio/strength arrive from
// Garmin/Strava on their own and don't belong here. "Shown today" is tracked in
// localStorage independent of whether anything was actually filled in, so skipping it
// doesn't reopen the prompt every time the app is reopened that same day.
export function MorningCheckIn({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [needsWeight, setNeedsWeight] = useState(false)
  const [needsSleep, setNeedsSleep] = useState(false)
  const [weightInput, setWeightInput] = useState('')
  const [sleepHoursPart, setSleepHoursPart] = useState('')
  const [sleepMinutesPart, setSleepMinutesPart] = useState('')

  useEffect(() => {
    async function check() {
      const today = todayISO()
      let lastShown: string | null = null
      try {
        lastShown = localStorage.getItem(STORAGE_KEY)
      } catch {
        // localStorage can throw (private mode, blocked storage) — just don't gate on it;
        // worst case the prompt shows more than once a day.
      }
      if (lastShown === today) return

      const [{ data: weightRow }, { data: sleepRow }] = await Promise.all([
        supabase.from('journal_entries').select('id').eq('type', 'weight').eq('date', today).limit(1).maybeSingle(),
        supabase.from('journal_entries').select('id').eq('type', 'sleep_hours').eq('date', today).maybeSingle(),
      ])
      const missingWeight = !weightRow
      const missingSleep = !sleepRow
      if (!missingWeight && !missingSleep) {
        try {
          localStorage.setItem(STORAGE_KEY, today)
        } catch {
          /* not critical if this doesn't persist */
        }
        return
      }
      setNeedsWeight(missingWeight)
      setNeedsSleep(missingSleep)
      setOpen(true)
    }
    check()
  }, [])

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, todayISO())
    } catch {
      /* not critical if this doesn't persist */
    }
    setOpen(false)
  }

  async function save() {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const today = todayISO()

    if (needsWeight && weightInput) {
      const value = Number(weightInput)
      if (!Number.isNaN(value)) {
        await supabase.from('journal_entries').insert({ type: 'weight', value_numeric: value, date: today, user_id: user.id })
      }
    }
    if (needsSleep && (sleepHoursPart || sleepMinutesPart)) {
      const value = (Number(sleepHoursPart) || 0) + (Number(sleepMinutesPart) || 0) / 60
      await supabase
        .from('journal_entries')
        .insert({ type: 'sleep_hours', value_numeric: Math.round(value * 10000) / 10000, date: today, user_id: user.id })
    }
    dismiss()
    onSaved()
  }

  if (!open) return null

  // An inline card at the top of Today's list rather than a modal over it — the prompt is
  // a nudge, not something worth blocking the screen for. The once-a-day localStorage
  // gate is unchanged, so skipping still keeps it away until tomorrow.
  return (
    <div className="rounded-[22px] border border-line bg-surface px-4 py-3.5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">Morning check-in</p>
        <button onClick={dismiss} className="shrink-0 text-xs font-medium text-ink-muted">
          Skip
        </button>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        {needsWeight && (
          <input
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
            type="number"
            step="0.1"
            placeholder="Weight kg"
            aria-label="Weight in kilograms"
            className="min-w-0 flex-1 rounded-2xl border border-line bg-page px-3 py-2.5 text-[13px] text-ink placeholder-ink-muted outline-none focus:border-pine"
          />
        )}
        {needsSleep && (
          <>
            <input
              value={sleepHoursPart}
              onChange={(e) => setSleepHoursPart(e.target.value)}
              type="number"
              placeholder="Slept h"
              aria-label="Hours slept"
              className="min-w-0 flex-1 rounded-2xl border border-line bg-page px-3 py-2.5 text-[13px] text-ink placeholder-ink-muted outline-none focus:border-pine"
            />
            <input
              value={sleepMinutesPart}
              onChange={(e) => setSleepMinutesPart(e.target.value)}
              type="number"
              placeholder="min"
              aria-label="Minutes slept"
              className="w-16 min-w-0 shrink-0 rounded-2xl border border-line bg-page px-3 py-2.5 text-[13px] text-ink placeholder-ink-muted outline-none focus:border-pine"
            />
          </>
        )}
        <button
          onClick={save}
          className="shrink-0 rounded-2xl bg-pine px-4 py-2.5 text-[13px] font-semibold text-white"
        >
          Save
        </button>
      </div>
    </div>
  )
}
