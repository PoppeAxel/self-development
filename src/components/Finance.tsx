import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { periodEndISO, periodStartISO, todayISO } from '../lib/dates'
import { accountInfo, formatKr, periodTotals, savingsAccounts, type SavingsAccount, type SavingsEntry } from '../lib/finance'
import { findOption } from '../lib/optionStore'
import type { OptionRow } from '../lib/editable'
import { useEdit } from '../contexts/EditContext'
import { EditDots, useLongPress } from './ItemMenu'
import { OptionSheet, type RefMover } from './OptionSheet'
import { ChipRail, HeroSegments, Screen } from './Screen'
import { ConfirmDialog } from './ConfirmDialog'
import { Pots } from './Pots'
import { Budget } from './Budget'
import { loadBankSavings } from '../lib/bankSavings'
import type { PeriodType } from '../lib/types'

// The Economy tab: Budget (bank import), Savings and Pots, switched in the hero. Savings are
// logged by hand — buffer, house loan, ETFs/stocks, withdrawals as negative amounts — plus
// what the Budget import implies (lib/bankSavings). A goal tracking "Saved (Finance)" sums
// the same rows, so the Goals screen and this tab can't disagree.

type Mode = 'deposit' | 'withdraw'
const PERIODS: { id: Exclude<PeriodType, 'week'>; label: string }[] = [
  { id: 'month', label: 'This month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'year', label: 'This year' },
]
const INPUT = 'min-w-0 flex-1 bg-transparent text-right text-sm font-semibold text-ink outline-none placeholder:font-medium placeholder:text-ink-faint'

// An account's logged entries move with it when it's deleted (bank-derived rows follow the
// Budget split rules instead, which only fill live accounts).
const ACCOUNT_REFS: RefMover = {
  noun: (n) => `${n} saved ${n === 1 ? 'entry' : 'entries'}`,
  valueOf: (r) => r.key,
  find: async (key) => ((await supabase.from('savings_entries').select('id').eq('account', key).throwOnError()).data ?? []).map((r) => r.id as string),
  move: async (ids, to) => {
    await supabase.from('savings_entries').update({ account: to }).in('id', ids).throwOnError()
  },
}

/** An account name that opens its sheet on long-press (and, in edit mode, carries a ⋯). */
function AccountLabel({ account, onEdit }: { account: SavingsAccount; onEdit: () => void }) {
  const { editing } = useEdit()
  const press = useLongPress(onEdit)
  const info = accountInfo(account)
  return (
    <span className="flex min-w-0 select-none items-center gap-1.5 [-webkit-touch-callout:none]" {...press}>
      <span className="text-base">{info.icon}</span>
      <span className="truncate text-[13px] font-medium text-ink-2">{info.label}</span>
      {editing && <EditDots onClick={onEdit} label={info.label} />}
    </span>
  )
}

export function Finance() {
  const [entries, setEntries] = useState<SavingsEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>('deposit')
  const [date, setDate] = useState(todayISO())
  const [amounts, setAmounts] = useState<Record<SavingsAccount, string>>({})
  const { editing } = useEdit()
  const [accountSheet, setAccountSheet] = useState<OptionRow | 'new' | null>(null)
  const editAccount = (key: SavingsAccount) => setAccountSheet(findOption('savings_account', key) ?? null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [period, setPeriod] = useState<Exclude<PeriodType, 'week'>>('month')
  const [showAll, setShowAll] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<SavingsEntry | null>(null)
  // Long-term savings (counts toward totals/goals) vs short-term pots (kept apart).
  const [view, setView] = useState<'long' | 'pots' | 'budget' | 'plan'>('budget')

  async function load() {
    const [{ data }, bank] = await Promise.all([
      supabase.from('savings_entries').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }),
      loadBankSavings('2000-01-01', '9999-12-31'),
    ])
    // Bank-derived rows (Budget → Avanza autogiros, amortization) count like logged ones but
    // can't be deleted here — they change with the import and the split rules.
    const fromBank = bank.map((e, i) => ({ ...e, id: `bank:${i}`, user_id: '', note: 'From bank (Budget)' }))
    const all = [...((data ?? []).map((e) => ({ ...e, amount: Number(e.amount) })) as SavingsEntry[]), ...fromBank]
    setEntries(all.sort((a, b) => b.date.localeCompare(a.date)))
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  // Paying off the loan can't be undone, so withdrawals only apply to buffer and investments.
  const accounts = savingsAccounts()
    .map((a) => a.key)
    .filter((a) => mode === 'deposit' || a !== 'mortgage')
  const parsed = accounts
    .map((a) => ({ account: a, value: Number((amounts[a] ?? '').replace(/\s/g, '').replace(',', '.')) }))
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
    setAmounts({})
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
      <HeroSegments
        options={[
          { id: 'budget', label: 'Budget' },
          { id: 'plan', label: 'Plan' },
          { id: 'long', label: 'Savings' },
          { id: 'pots', label: 'Pots' },
        ]}
        value={view}
        onChange={setView}
      />
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
      {view === 'budget' && <p className="mt-4 text-sm font-medium leading-snug text-white">Where the money went each pay period, from Nordea's CSV export.</p>}
      {view === 'plan' && <p className="mt-4 text-sm font-medium leading-snug text-white">What you mean to spend each pay period, against what you did.</p>}
    </>
  )

  return (
    <Screen title="Economy" onRefresh={load} hero={hero}>
      {view === 'pots' ? (
        <Pots />
      ) : view === 'budget' || view === 'plan' ? (
        <Budget view={view === 'plan' ? 'plan' : 'actual'} />
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
              <AccountLabel account={a} onEdit={() => editAccount(a)} />
              <input
                value={amounts[a] ?? ''}
                onChange={(e) => setAmounts((s) => ({ ...s, [a]: e.target.value }))}
                inputMode="decimal"
                placeholder="0"
                className={INPUT}
              />
              <span className="text-xs text-ink-muted">kr</span>
            </label>
          ))}
          {editing && (
            <button type="button" onClick={() => setAccountSheet('new')} className="border-t border-line px-3.5 py-2.5 text-left text-[13px] font-medium text-pine">
              + New account
            </button>
          )}
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
        {Object.keys(selected.byAccount).map((a) => {
          const v = selected.byAccount[a]
          const max = Math.max(...Object.values(selected.byAccount).map((x) => Math.abs(x)), 1)
          return (
            <div key={a} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <AccountLabel account={a} onEdit={() => editAccount(a)} />
                <span className={`font-semibold ${v < 0 ? 'text-cat-rose-ink' : 'text-ink'}`}>{formatKr(v)}</span>
              </div>
              <span className="block h-1.5 overflow-hidden rounded-full bg-[#ece5d7]">
                <span className="block h-full rounded-full" style={{ width: `${(Math.max(v, 0) / max) * 100}%`, background: accountInfo(a).color }} />
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
              <span className="text-base">{accountInfo(e.account).icon}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-medium text-ink">{e.note || accountInfo(e.account).label}</span>
                <span className="text-[11px] text-ink-muted">{format(new Date(e.date + 'T00:00:00'), 'd MMM yyyy')}</span>
              </span>
              <span className={`shrink-0 text-[13px] font-semibold ${e.amount < 0 ? 'text-cat-rose-ink' : 'text-ink'}`}>
                {e.amount > 0 ? '+' : '−'}
                {formatKr(Math.abs(e.amount))}
              </span>
              {e.id.startsWith('bank:') ? (
                <span className="shrink-0 text-xs" title="From the bank import">
                  🏦
                </span>
              ) : (
                <button onClick={() => setConfirmDelete(e)} className="shrink-0 text-ink-faint" aria-label="Delete entry">
                  ✕
                </button>
              )}
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
        message={confirmDelete ? `${accountInfo(confirmDelete.account).label} · ${formatKr(confirmDelete.amount)} on ${confirmDelete.date}` : ''}
        confirmLabel="Delete"
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
      {accountSheet && (
        <OptionSheet
          kind="savings_account"
          row={accountSheet === 'new' ? null : accountSheet}
          noun="account"
          color="hex"
          newMeta={{ buffer: false }}
          refs={ACCOUNT_REFS}
          onChanged={load}
          onClose={() => setAccountSheet(null)}
          fields={(meta, set) =>
            accountSheet !== 'new' && accountSheet.system ? null : (
              <label className="flex items-center gap-2 text-[13px] text-ink-2">
                <input type="checkbox" checked={meta.buffer === true} onChange={(e) => set({ buffer: e.target.checked })} className="accent-pine" />
                Filled from the bank’s savings (Budget → split rules)
              </label>
            )
          }
        />
      )}
    </Screen>
  )
}
