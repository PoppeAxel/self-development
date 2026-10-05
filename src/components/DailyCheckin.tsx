import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { CHECKIN_INFO, CHECKIN_KEYS, type CheckinKey, type DailyCheckin as Checkin } from '../lib/dailyCheckin'

// The evening check-in, full screen over Today: one question per step, tap a number and it
// moves on by itself (six taps), then a last step with an optional note and Save. Opened
// from Today's red/green button, or straight from the 22:00 push (/?checkin=1).
// Re-opening a night that's already saved starts on the last step, prefilled, to edit.

type Scores = Record<CheckinKey, number | null>
const EMPTY: Scores = { mood: null, energy: null, calm: null, focus: null, connection: null, body: null }
const NOTE_STEP = CHECKIN_KEYS.length

export function DailyCheckin({ date, onClose, onSaved }: { date: string; onClose: () => void; onSaved: () => void }) {
  const [scores, setScores] = useState<Scores>(EMPTY)
  const [note, setNote] = useState('')
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase
      .from('daily_checkins')
      .select('*')
      .eq('date', date)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as Checkin | null
        if (!row) return
        setScores(Object.fromEntries(CHECKIN_KEYS.map((k) => [k, row[k]])) as Scores)
        setNote(row.note ?? '')
        setStep(NOTE_STEP)
      })
  }, [date])

  function rate(key: CheckinKey, n: number) {
    setScores((s) => ({ ...s, [key]: n }))
    // A beat to see the tap land before the next question comes in.
    setTimeout(() => setStep((s) => Math.min(s + 1, NOTE_STEP)), 180)
  }

  async function save() {
    if (saving) return
    setSaving(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('daily_checkins').upsert({ user_id: user.id, date, ...scores, note: note.trim() || null }, { onConflict: 'user_id,date' })
    onSaved()
    onClose()
  }

  const key = CHECKIN_KEYS[step] as CheckinKey | undefined

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-page">
      <header className="hero shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} aria-label="Close" className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[14px] bg-white/16 text-base text-white">
            ✕
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[22px] font-semibold">Daily check-in</h1>
            <p className="mt-0.5 text-xs font-medium text-white">{format(new Date(date + 'T00:00:00'), 'EEEE d MMMM')}</p>
          </div>
        </div>
        <div className="mt-4 flex gap-[5px]">
          {[...CHECKIN_KEYS, 'note'].map((k, i) => (
            <button
              key={k}
              onClick={() => setStep(i)}
              aria-label={`Go to step ${i + 1}`}
              className="h-2 flex-1 rounded-full"
              style={{ background: i === step ? '#fff' : i < NOTE_STEP && scores[k as CheckinKey] != null ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.22)' }}
            />
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-8 pb-4">
        {key ? (
          <div className="flex flex-col gap-6">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.1em] text-ink-3">
                {step + 1} OF {CHECKIN_KEYS.length} · {CHECKIN_INFO[key].label.toUpperCase()}
              </p>
              <p className="mt-2 text-[24px] font-semibold leading-tight text-ink">{CHECKIN_INFO[key].question}</p>
            </div>
            <div>
              <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label={CHECKIN_INFO[key].label}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    role="radio"
                    aria-checked={scores[key] === n}
                    onClick={() => rate(key, n)}
                    className={`h-14 rounded-2xl text-lg ${scores[key] === n ? 'bg-pine font-semibold text-white shadow-card' : 'border border-line bg-surface font-medium text-ink-2'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[11px] font-medium text-ink-muted">
                <span>1 · {CHECKIN_INFO[key].low}</span>
                <span>{CHECKIN_INFO[key].high} · 10</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-3 gap-2">
              {CHECKIN_KEYS.map((k, i) => (
                // Tap a score to go back and change it.
                <button key={k} onClick={() => setStep(i)} className="flex flex-col items-center rounded-2xl border border-line bg-surface py-2.5">
                  <span className="text-xl font-semibold text-ink">{scores[k] ?? '–'}</span>
                  <span className="text-[11px] font-medium text-ink-muted">{CHECKIN_INFO[k].label}</span>
                </button>
              ))}
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-[0.1em] text-ink-3">ANY THOUGHTS? (OPTIONAL)</p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                placeholder="A few words about the day…"
                className="mt-2 w-full rounded-2xl border border-line bg-surface px-3.5 py-3 text-[14px] text-ink outline-none placeholder:text-ink-disabled focus:border-pine"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 gap-2.5 px-5 pt-2 pb-7 safe-bottom">
        {key ? (
          <>
            <button onClick={() => (step === 0 ? onClose() : setStep(step - 1))} className="flex-1 rounded-[20px] bg-track py-3 text-sm font-medium text-ink-2">
              {step === 0 ? 'Cancel' : 'Back'}
            </button>
            <button onClick={() => setStep(step + 1)} className="flex-1 rounded-[20px] bg-track py-3 text-sm font-medium text-ink-2">
              Skip
            </button>
          </>
        ) : (
          <button
            onClick={save}
            disabled={saving || CHECKIN_KEYS.every((k) => scores[k] == null)}
            className="flex-1 rounded-[20px] bg-pine py-3.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Save check-in
          </button>
        )}
      </div>
    </div>
  )
}
