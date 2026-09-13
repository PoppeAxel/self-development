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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={dismiss}>
      <div className="w-full max-w-xs rounded-3xl border border-line bg-surface p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
        <p className="text-lg font-bold text-ink">Good morning ☀️</p>
        <p className="mt-1 text-sm text-ink-3">Quick check-in before the day gets going.</p>
        <div className="mt-4 flex flex-col gap-3">
          {needsWeight && (
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-3">Weight (kg)</label>
              <input
                autoFocus
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value)}
                type="number"
                step="0.1"
                placeholder="e.g. 82.4"
                className="w-full rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
              />
            </div>
          )}
          {needsSleep && (
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-3">Sleep last night</label>
              <div className="flex gap-2">
                <input
                  value={sleepHoursPart}
                  onChange={(e) => setSleepHoursPart(e.target.value)}
                  type="number"
                  placeholder="Hours"
                  className="min-w-0 flex-1 rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
                />
                <input
                  value={sleepMinutesPart}
                  onChange={(e) => setSleepMinutesPart(e.target.value)}
                  type="number"
                  placeholder="Minutes"
                  className="min-w-0 flex-1 rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
                />
              </div>
            </div>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={dismiss} className="flex-1 rounded-[20px] bg-track px-4 py-2.5 font-medium text-ink-2">
            Skip today
          </button>
          <button onClick={save} className="flex-1 rounded-[20px] bg-pine px-4 py-2.5 font-semibold text-white">
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
