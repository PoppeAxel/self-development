import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { periodEndISO, periodStartISO, todayISO } from '../lib/dates'
import { ACCOUNT_INFO, SAVINGS_ACCOUNTS, formatKr, periodTotals, type SavingsAccount, type SavingsEntry } from '../lib/finance'
import { ChipRail, Screen } from './Screen'
import { ConfirmDialog } from './ConfirmDialog'
import { Pots } from './Pots'
import type { PeriodType } from '../lib/types'

// Journal → Finance. Savings logged by hand: what went to the buffer, the house loan and
// ETFs/stocks, plus withdrawals (stored as negative amounts). A goal tracking "Saved
// (Finance)" sums the same rows, so the Goals screen and this tab can't disagree.
// Renders its own <Screen> (Journal hands over its tab pills), like Training used to.

type Mode = 'deposit' | 'withdraw'
const PERIODS: { id: Exclude<PeriodType, 'week'>; label: string }[] = [
  { id: 'month', label: 'This month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'year', label: 'This year' },
]
const INPUT = 'min-w-0 flex-1 bg-transparent text-right text-sm font-semibold text-ink outline-none placeholder:font-medium placeholder:text-ink-faint'

export function Finance({ segments }: { segments: React.ReactNode }) {
  const [entries, setEntries] = useState<SavingsEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>('deposit')
  const [date, setDate] = useState(todayISO())
  const [amounts, setAmounts] = useState<Record<SavingsAccount, string>>({ buffer: '', mortgage: '', investments: '' })
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [period, setPeriod] = useState<Exclude<PeriodType, 'week'>>('month')
  const [showAll, setShowAll] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<SavingsEntry | null>(null)
  // Long-term savings (counts toward totals/goals) vs short-term pots (kept apart).
  const [view, setView] = useState<'long' | 'pots'>('long')

  async function load() {
    const { data } = await supabase.from('savings_entries').select('*').order('date', { ascending: false }).order('created_at', { ascending: false })
    setEntries((data ?? []).map((e) => ({ ...e, amount: Number(e.amount) })) as SavingsEntry[])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  // Paying off the loan can't be undone, so withdrawals only apply to buffer and investments.
  const accounts = mode === 'deposit' ? SAVINGS_ACCOUNTS : SAVINGS_ACCOUNTS.filter((a) => a !== 'mortgage')
  const parsed = accounts
    .map((a) => ({ account: a, value: Number(amounts[a].replace(/\s/g, '').replace(',', '.')) }))
    .filter((r) => Number.isFinite(r.value) && r.value > 0)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!parsed.length || saving) return
    setSaving(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('savings_entries').insert(
      parsed.map((r) => ({ user_id: user.id, date, account: r.account, amount: mode === 'withdraw' ? -r.value : r.value, note: note.trim() || null })),
    )
    setAmounts({ buffer: '', mortgage: '', investments: '' })
    setNote('')
    setSaving(false)
    load()
  }

  async function remove(entry: SavingsEntry) {
    setConfirmDelete(null)
    setEntries((es) => es.filter((e) => e.id !== entry.id))
    await supabase.from('savings_entries').delete().eq('id', entry.id)
  }

  const totals = (p: Exclude<PeriodType, 'week'>) => {
    const start = periodStartISO(p)
    return periodTotals(entries, start, periodEndISO(p, start))
  }
  const year = totals('year')
  const selected = totals(period)
  const recent = showAll ? entries : entries.slice(0, 8)

  const hero = (
    <>
      {segments}
      {view === 'long' && (
      <div className="mt-5 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.07em] text-white/72">SAVED IN {format(new Date(), 'yyyy')}</p>
          <p className="mt-1 text-[34px] font-semibold leading-none">{formatKr(year.net)}</p>
        </div>
        <span className="flex flex-col items-end gap-1.5">
          <span className="rounded-full bg-white/16 px-[11px] py-[5px] text-xs font-medium text-white">Q · {formatKr(totals('quarter').net)}</span>
          <span className="rounded-full bg-white/16 px-[11px] py-[5px] text-xs font-medium text-white">
            {format(new Date(), 'MMM')} · {formatKr(totals('month').net)}
          </span>
        </span>
      </div>
      )}
      {view === 'pots' && <p className="mt-4 text-sm font-medium leading-snug text-white">Short-term saving for one thing at a time — a ring, a watch, a trip.</p>}
    </>
  )

  return (
    <Screen title="Journal" onRefresh={load} hero={hero}>
      <ChipRail
        options={[
          { id: 'long', label: 'Long-term savings' },
          { id: 'pots', label: 'Pots' },
        ]}
        value={view}
        onChange={setView}
      />
      {view === 'pots' ? (
        <Pots />
      ) : (
      <>
      {/* Log form */}
      <form onSubmit={save} className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-3.5 shadow-card">
        <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-page p-1">
          {(['deposit', 'withdraw'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-xl py-2 text-xs ${mode === m ? 'bg-surface font-semibold text-pine-dark shadow-card' : 'font-medium text-ink-3'}`}
            >
              {m === 'deposit' ? 'Saved' : 'Withdrew'}
            </button>
          ))}
        </div>
        <div className="flex flex-col overflow-hidden rounded-2xl border border-line">
          {accounts.map((a, i) => (
            <label key={a} className={`flex items-center gap-3 px-3.5 py-2.5 ${i > 0 ? 'border-t border-line' : ''}`}>
              <span className="text-base">{ACCOUNT_INFO[a].icon}</span>
              <span className="shrink-0 text-[13px] font-medium text-ink-2">{ACCOUNT_INFO[a].label}</span>
              <input
                value={amounts[a]}
                onChange={(e) => setAmounts((s) => ({ ...s, [a]: e.target.value }))}
                inputMode="decimal"
                placeholder="0"
                className={INPUT}
              />
              <span className="text-xs text-ink-muted">kr</span>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-line bg-page px-3 py-2 text-[13px] text-ink outline-none focus:border-pine"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="min-w-0 flex-1 rounded-xl border border-line bg-page px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-disabled focus:border-pine"
          />
        </div>
        <button type="submit" disabled={!parsed.length || saving} className="rounded-2xl bg-pine py-3 text-sm font-semibold text-white disabled:opacity-50">
          {mode === 'deposit' ? 'Save' : 'Save withdrawal'}
          {parsed.length ? ` · ${formatKr(parsed.reduce((s, r) => s + r.value, 0))}` : ''}
        </button>
      </form>

      {/* Summary */}
      <ChipRail options={PERIODS} value={period} onChange={setPeriod} />
      <div className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-surface p-3.5 shadow-card">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold tracking-[0.06em] text-ink-3">NET SAVED</span>
          <span className={`text-xl font-semibold ${selected.net < 0 ? 'text-cat-rose-ink' : 'text-ink'}`}>{formatKr(selected.net)}</span>
        </div>
        {SAVINGS_ACCOUNTS.map((a) => {
          const v = selected.byAccount[a]
          const max = Math.max(...SAVINGS_ACCOUNTS.map((x) => Math.abs(selected.byAccount[x])), 1)
          return (
            <div key={a} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="text-ink-2">
                  {ACCOUNT_INFO[a].icon} {ACCOUNT_INFO[a].label}
                </span>
                <span className={`font-semibold ${v < 0 ? 'text-cat-rose-ink' : 'text-ink'}`}>{formatKr(v)}</span>
              </div>
              <span className="block h-1.5 overflow-hidden rounded-full bg-[#ece5d7]">
                <span className="block h-full rounded-full" style={{ width: `${(Math.max(v, 0) / max) * 100}%`, background: ACCOUNT_INFO[a].color }} />
              </span>
            </div>
          )
        })}
        {selected.withdrawn > 0 && <p className="text-[11px] font-medium text-ink-muted">Includes {formatKr(selected.withdrawn)} withdrawn.</p>}
      </div>

      {/* Entries */}
      <p className="text-[11px] font-semibold tracking-[0.1em] text-ink-3">ENTRIES</p>
      {loading ? (
        <p className="text-sm text-ink-disabled">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="-mt-1 text-sm text-ink-disabled">Nothing logged yet. Add what you saved above.</p>
      ) : (
        <div className="-mt-1 overflow-hidden rounded-[20px] border border-line bg-surface">
          {recent.map((e, i) => (
            <div key={e.id} className={`flex items-center gap-3 px-3.5 py-2.5 ${i > 0 ? 'border-t border-line' : ''}`}>
              <span className="text-base">{ACCOUNT_INFO[e.account].icon}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-medium text-ink">{e.note || ACCOUNT_INFO[e.account].label}</span>
                <span className="text-[11px] text-ink-muted">{format(new Date(e.date + 'T00:00:00'), 'd MMM yyyy')}</span>
              </span>
              <span className={`shrink-0 text-[13px] font-semibold ${e.amount < 0 ? 'text-cat-rose-ink' : 'text-ink'}`}>
                {e.amount > 0 ? '+' : '−'}
                {formatKr(Math.abs(e.amount))}
              </span>
              <button onClick={() => setConfirmDelete(e)} className="shrink-0 text-ink-faint" aria-label="Delete entry">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {entries.length > 8 && (
        <button onClick={() => setShowAll((v) => !v)} className="self-center pb-2 text-xs font-medium text-pine">
          {showAll ? 'Show fewer' : `Show all ${entries.length}`}
        </button>
      )}

      </>
      )}

      <ConfirmDialog
        open={confirmDelete != null}
        title="Delete this entry?"
        message={confirmDelete ? `${ACCOUNT_INFO[confirmDelete.account].label} · ${formatKr(confirmDelete.amount)} on ${confirmDelete.date}` : ''}
        confirmLabel="Delete"
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </Screen>
  )
}
