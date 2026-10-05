import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { CHECKIN_INFO, CHECKIN_KEYS, type DailyCheckin as Checkin } from '../lib/dailyCheckin'
import { DailyCheckin } from './DailyCheckin'
import { Screen } from './Screen'

// Journal → Diary: every saved daily check-in, newest first. Tapping a day opens it in the
// check-in's read-back (same overlay Today uses, with Edit). Renders its own <Screen>;
// Journal hands over its tab pills, like Media/Finance.
export function DiaryList({ segments }: { segments: React.ReactNode }) {
  const [days, setDays] = useState<Checkin[]>([])
  const [loading, setLoading] = useState(true)
  const [openDate, setOpenDate] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase.from('daily_checkins').select('*').order('date', { ascending: false })
    setDays((data ?? []) as Checkin[])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const hero = (
    <>
      {segments}
      <div className="mt-5">
        <p className="text-[11px] font-semibold tracking-[0.07em] text-white/72">DAYS WRITTEN</p>
        <p className="mt-1 text-[34px] font-semibold leading-none">{days.length}</p>
      </div>
    </>
  )

  return (
    <Screen title="Journal" onRefresh={load} hero={hero}>
      {loading ? (
        <p className="text-sm text-ink-disabled">Loading…</p>
      ) : days.length === 0 ? (
        <p className="text-sm text-ink-disabled">No check-ins yet — tap Check-in on Today tonight.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {days.map((d) => (
            <button key={d.id} onClick={() => setOpenDate(d.date)} className="flex flex-col gap-2 rounded-[18px] border border-line bg-surface px-3.5 py-3 text-left">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-ink">{format(new Date(d.date + 'T00:00:00'), 'EEEE d MMMM')}</span>
                <span className="text-ink-faint">›</span>
              </div>
              <div className="grid grid-cols-6 gap-1 text-center">
                {CHECKIN_KEYS.map((k) => (
                  <span key={k} className="flex flex-col">
                    <span className="text-[15px] font-semibold tabular-nums text-ink">{d[k] ?? '–'}</span>
                    <span className="text-[9px] font-medium text-ink-muted">{CHECKIN_INFO[k].label}</span>
                  </span>
                ))}
              </div>
              {d.note && <p className="line-clamp-2 text-xs leading-relaxed text-ink-2">{d.note}</p>}
            </button>
          ))}
        </div>
      )}
      {openDate && <DailyCheckin date={openDate} onClose={() => setOpenDate(null)} onSaved={load} />}
    </Screen>
  )
}
