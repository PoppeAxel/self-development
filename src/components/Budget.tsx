import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { formatKr } from '../lib/finance'
import {
  BUDGET_CATEGORIES,
  CATEGORY_INFO,
  GROUP_LABEL,
  decodeCsv,
  guessCategory,
  merchantKey,
  parseNordeaCsv,
  payMonthOf,
  payPeriod,
  periodBudget,
  shiftMonth,
  type BankTransaction,
  type BudgetCategory,
  type BudgetGroup,
} from '../lib/budget'

// Journal → Finance → Budget: import Nordea's CSV export (no bank API), see income, saved,
// fixed costs, variable spending and left over per pay period (salary day → day before the
// next). Categories are guessed on import; changing one applies to every transaction from
// that merchant and to future imports — no rules to maintain.

const PICKER_GROUPS: BudgetGroup[] = ['income', 'saved', 'fixed', 'variable', 'shared', 'ignored']

type Row = Pick<BankTransaction, 'id' | 'description' | 'category'>

// PostgREST caps a response at 1000 rows, so page through everything.
async function fetchAllMerchants(): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('bank_transactions').select('id, description, category').order('date').range(from, from + 999)
    out.push(...((data ?? []) as Row[]))
    if (!data || data.length < 1000) return out
  }
}

export function Budget() {
  // The calendar month whose salary opens the period shown.
  const [month, setMonth] = useState(payMonthOf(format(new Date(), 'yyyy-MM-dd')))
  // This month and the next — enough to find both paydays around the period.
  const [loaded, setLoaded] = useState<BankTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase
      .from('bank_transactions')
      .select('id, date, amount, description, category')
      .gte('date', `${month}-01`)
      .lt('date', `${shiftMonth(month, 2)}-01`)
      .order('date', { ascending: false })
    setLoaded(((data ?? []) as BankTransaction[]).map((t) => ({ ...t, amount: Number(t.amount) })))
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [month]) // eslint-disable-line react-hooks/exhaustive-deps

  async function importFile(file: File) {
    setImporting(true)
    setMessage(null)
    try {
      const { rows, skipped } = parseNordeaCsv(decodeCsv(await file.arrayBuffer()))
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in.')
      // Ordered oldest first, so the latest choice per merchant wins.
      const learned = new Map((await fetchAllMerchants()).map((r) => [merchantKey(r.description), r.category]))
      let added = 0
      for (let i = 0; i < rows.length; i += 500) {
        const { data, error } = await supabase
          .from('bank_transactions')
          .upsert(
            rows.slice(i, i + 500).map((r) => ({ ...r, user_id: user.id, category: guessCategory(r.description, r.amount, learned) })),
            { onConflict: 'user_id,import_key', ignoreDuplicates: true },
          )
          .select('id')
        if (error) throw error
        added += data?.length ?? 0
      }
      setMessage(`Imported ${added} new · ${rows.length - added} already there${skipped ? ` · ${skipped} pending/blank skipped` : ''}`)
      const latest = rows.reduce((m, r) => (r.date > m ? r.date : m), '')
      if (latest && payMonthOf(latest) !== month) setMonth(payMonthOf(latest))
      else load()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Import failed.')
    }
    setImporting(false)
  }

  async function recategorize(tx: BankTransaction, category: BudgetCategory) {
    const key = merchantKey(tx.description)
    setLoaded((ts) => ts.map((t) => (merchantKey(t.description) === key ? { ...t, category } : t)))
    const ids = (await fetchAllMerchants()).filter((r) => merchantKey(r.description) === key).map((r) => r.id)
    await supabase.from('bank_transactions').update({ category }).in('id', ids)
  }

  const { start, end } = payPeriod(month, loaded)
  const txs = loaded.filter((t) => t.date >= start && t.date <= end)
  const b = periodBudget(txs, start, end)
  const maxSpend = Math.max(...b.byCategory.map((c) => c.amount), 1)
  const day = (iso: string) => format(new Date(iso + 'T00:00:00'), 'd MMM')
  const step = (n: number) => setMonth(shiftMonth(month, n))

  return (
    <>
      {/* Import */}
      <label className={`flex items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong bg-surface py-3 text-sm font-semibold text-pine ${importing ? 'opacity-50' : ''}`}>
        {importing ? 'Importing…' : '⬆️ Import Nordea CSV'}
        <input
          type="file"
          accept=".csv,.txt,text/csv"
          disabled={importing}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) importFile(file)
          }}
        />
      </label>
      {message && <p className="-mt-1 text-xs font-medium text-ink-3">{message}</p>}

      {/* Month */}
      <div className="flex items-center justify-between">
        <button onClick={() => step(-1)} className="px-2 text-lg text-ink-3" aria-label="Previous pay period">
          ‹
        </button>
        <span className="text-sm font-semibold text-ink">
          {day(start)} – {day(end)}
        </span>
        <button onClick={() => step(1)} className="px-2 text-lg text-ink-3" aria-label="Next pay period">
          ›
        </button>
      </div>

      <div className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-surface p-3.5 shadow-card">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold tracking-[0.06em] text-ink-3">LEFT OVER</span>
          <span className={`text-xl font-semibold ${b.left < 0 ? 'text-cat-rose-ink' : 'text-ink'}`}>{formatKr(b.left)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center">
          {[
            ['In', b.income],
            ['Saved', b.saved],
            ['Fixed costs', b.fixed],
            ['Variable', b.variable],
          ].map(([label, v]) => (
            <span key={label} className="flex flex-col rounded-xl bg-page py-2">
              <span className="text-[11px] font-medium text-ink-muted">{label}</span>
              <span className="text-[13px] font-semibold text-ink">{formatKr(v as number)}</span>
            </span>
          ))}
        </div>
        {(['fixed', 'variable'] as const).map((group) => {
          const rows = b.byCategory.filter((c) => CATEGORY_INFO[c.category].group === group)
          if (!rows.length) return null
          return (
            <div key={group} className="flex flex-col gap-2.5">
              <p className="mt-1 text-[11px] font-semibold tracking-[0.1em] text-ink-3">{GROUP_LABEL[group].toUpperCase()}</p>
              {rows.map(({ category, amount }) => (
                <div key={category} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between text-[13px]">
                    <span className="text-ink-2">
                      {CATEGORY_INFO[category].icon} {CATEGORY_INFO[category].label}
                    </span>
                    <span className={`font-semibold ${amount < 0 ? 'text-pine' : 'text-ink'}`}>
                      {amount < 0 ? `+${formatKr(-amount)} back` : formatKr(amount)}
                    </span>
                  </div>
                  <span className="block h-1.5 overflow-hidden rounded-full bg-[#ece5d7]">
                    <span className="block h-full rounded-full" style={{ width: `${(Math.max(amount, 0) / maxSpend) * 100}%`, background: CATEGORY_INFO[category].color }} />
                  </span>
                </div>
              ))}
            </div>
          )
        })}
        {b.sharedBack !== 0 && (
          <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2.5 text-[13px]">
            <span className="text-ink-2">
              {CATEGORY_INFO.shared.icon} {CATEGORY_INFO.shared.label}
            </span>
            <span className={`font-semibold ${b.sharedBack > 0 ? 'text-pine' : 'text-ink'}`}>
              {b.sharedBack > 0 ? `+${formatKr(b.sharedBack)} back` : formatKr(-b.sharedBack)}
            </span>
          </div>
        )}
      </div>

      {/* Transactions */}
      <p className="text-[11px] font-semibold tracking-[0.1em] text-ink-3">TRANSACTIONS</p>
      {loading ? (
        <p className="text-sm text-ink-disabled">Loading…</p>
      ) : txs.length === 0 ? (
        <p className="-mt-1 text-sm text-ink-disabled">Nothing this period. In Nordea's netbank, export the account's transactions as CSV and import the file above.</p>
      ) : (
        <div className="-mt-1 overflow-hidden rounded-[20px] border border-line bg-surface">
          {txs.map((t, i) => (
            <div key={t.id} className={`flex items-center gap-3 px-3.5 py-2.5 ${i > 0 ? 'border-t border-line' : ''}`}>
              <span className="text-base">{CATEGORY_INFO[t.category].icon}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-medium text-ink">{t.description}</span>
                <span className="flex items-center gap-1 text-[11px] text-ink-muted">
                  {day(t.date)} ·
                  <select
                    value={t.category}
                    onChange={(e) => recategorize(t, e.target.value as BudgetCategory)}
                    className="min-w-0 truncate bg-transparent text-[11px] text-pine outline-none"
                    aria-label="Category"
                  >
                    {PICKER_GROUPS.map((g) => (
                      <optgroup key={g} label={GROUP_LABEL[g]}>
                        {BUDGET_CATEGORIES.filter((c) => CATEGORY_INFO[c].group === g).map((c) => (
                          <option key={c} value={c}>
                            {CATEGORY_INFO[c].label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </span>
              </span>
              <span className={`shrink-0 text-[13px] font-semibold ${t.amount > 0 ? 'text-pine' : 'text-ink'}`}>
                {t.amount > 0 ? '+' : '−'}
                {formatKr(Math.abs(t.amount))}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
