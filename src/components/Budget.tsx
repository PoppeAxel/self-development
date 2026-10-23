import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { ACCOUNT_INFO, SAVINGS_ACCOUNTS, formatKr } from '../lib/finance'
import { loadBudgetRules } from '../lib/bankSavings'
import {
  BUDGET_CATEGORIES,
  CATEGORY_INFO,
  GROUP_LABEL,
  PLANNABLE,
  daysLeft,
  decodeCsv,
  guessCategory,
  merchantKey,
  parseNordeaCsv,
  payMonthOf,
  payPeriod,
  periodBudget,
  planRows,
  shiftMonth,
  type BankTransaction,
  type BudgetCategory,
  type BudgetGroup,
  type BudgetTargets,
  type SplitRules,
} from '../lib/budget'

// Economy → Budget: import Nordea's CSV export (no bank API), see income, saved, fixed costs,
// variable spending and left over per pay period (salary day → day before the next), each
// category against its monthly plan. Categories are guessed on import; changing one applies to
// every transaction from that merchant and to future imports — no rules to maintain.

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
  const [rules, setRules] = useState<SplitRules>({ bufferPerMonth: 0, amortizationPerMonth: 0 })
  const [editingRules, setEditingRules] = useState(false)
  const [targets, setTargets] = useState<BudgetTargets>({})
  const [editingPlan, setEditingPlan] = useState(false)

  useEffect(() => {
    loadBudgetRules().then(setRules)
    supabase
      .from('user_settings')
      .select('budget_targets')
      .maybeSingle()
      .then(({ data }) => setTargets((data?.budget_targets ?? {}) as BudgetTargets))
  }, [])

  async function saveTarget(category: BudgetCategory, raw: string) {
    const value = Number(raw.replace(/\s/g, '').replace(',', '.') || 0)
    if (!Number.isFinite(value) || value < 0 || value === (targets[category] ?? 0)) return
    const next = { ...targets, [category]: value }
    setTargets(next)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('user_settings').upsert({ user_id: user.id, budget_targets: next })
  }

  async function saveRule(key: keyof SplitRules, raw: string) {
    const value = Number(raw.replace(/\s/g, '').replace(',', '.'))
    if (!Number.isFinite(value) || value < 0 || value === rules[key]) return
    setRules((r) => ({ ...r, [key]: value }))
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase
      .from('user_settings')
      .upsert({ user_id: user.id, [key === 'bufferPerMonth' ? 'budget_buffer_per_month' : 'mortgage_amortization_per_month']: value })
  }

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
  const b = periodBudget(txs, start, end, rules)
  const maxSpend = Math.max(...b.byCategory.map((c) => c.amount), 1)
  const plan = planRows(b, targets)
  const planned = PLANNABLE.reduce((s, c) => s + (targets[c] ?? 0), 0)
  // Only categories with a plan count here — unplanned spending would make "of planned" lie.
  const plannedSpent = plan.filter((r) => r.target != null).reduce((s, r) => s + r.actual, 0)
  const remainingDays = daysLeft(format(new Date(), 'yyyy-MM-dd'), end, start)
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
        {b.saved !== 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="mt-1 text-[11px] font-semibold tracking-[0.1em] text-ink-3">SAVED</p>
            {SAVINGS_ACCOUNTS.filter((a) => b.savedByAccount[a] !== 0).map((a) => (
              <div key={a} className="flex items-baseline justify-between text-[13px]">
                <span className="text-ink-2">
                  {ACCOUNT_INFO[a].icon} {ACCOUNT_INFO[a].label}
                </span>
                <span className="font-semibold text-ink">{formatKr(b.savedByAccount[a])}</span>
              </div>
            ))}
          </div>
        )}
        {planned > 0 && (
          <p className={`mt-1 text-[11px] font-medium ${plannedSpent > planned ? 'text-cat-rose-ink' : 'text-ink-muted'}`}>
            Planned categories: {formatKr(plannedSpent)} of {formatKr(planned)}
            {remainingDays != null && ` · ${remainingDays} ${remainingDays === 1 ? 'day' : 'days'} left`}
          </p>
        )}
        {(['fixed', 'variable'] as const).map((group) => {
          const rows = plan.filter((r) => CATEGORY_INFO[r.category].group === group)
          if (!rows.length) return null
          return (
            <div key={group} className="flex flex-col gap-2.5">
              <p className="mt-1 text-[11px] font-semibold tracking-[0.1em] text-ink-3">{GROUP_LABEL[group].toUpperCase()}</p>
              {rows.map(({ category, actual, target }) => {
                const over = target != null && actual > target
                const width = target != null ? Math.min(Math.max(actual, 0) / target, 1) : Math.max(actual, 0) / maxSpend
                return (
                  <div key={category} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="min-w-0 truncate text-ink-2">
                        {CATEGORY_INFO[category].icon} {category === 'mortgage' ? 'Mortgage interest' : CATEGORY_INFO[category].label}
                      </span>
                      <span className={`shrink-0 font-semibold ${over ? 'text-cat-rose-ink' : actual < 0 ? 'text-pine' : 'text-ink'}`}>
                        {actual < 0 ? `+${formatKr(-actual)} back` : formatKr(actual)}
                        {target != null && <span className="font-medium text-ink-muted"> / {formatKr(target)}</span>}
                      </span>
                    </div>
                    <span className="block h-1.5 overflow-hidden rounded-full bg-[#ece5d7]">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${width * 100}%`, background: over ? 'var(--color-cat-rose)' : CATEGORY_INFO[category].color }}
                      />
                    </span>
                    {target != null && (
                      <span className={`text-[11px] ${over ? 'font-medium text-cat-rose-ink' : 'text-ink-muted'}`}>
                        {over ? `${formatKr(actual - target)} over` : `${formatKr(target - actual)} left`}
                      </span>
                    )}
                  </div>
                )
              })}
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
        <button
          onClick={() => setEditingPlan((v) => !v)}
          className="mt-1 rounded-xl border border-line bg-page py-2 text-[13px] font-semibold text-pine"
        >
          {editingPlan ? 'Done' : planned > 0 ? '✏️ Edit monthly plan' : '✏️ Plan your month'}
        </button>
        {editingPlan && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] text-ink-muted">What you plan to spend per pay period. Leave a category empty for no plan.</p>
            {(['fixed', 'variable'] as const).map((group) => (
              <div key={group} className="flex flex-col gap-1.5">
                <p className="mt-1 text-[11px] font-semibold tracking-[0.1em] text-ink-3">{GROUP_LABEL[group].toUpperCase()}</p>
                {PLANNABLE.filter((c) => CATEGORY_INFO[c].group === group).map((c) => (
                  <label key={c} className="flex items-center gap-3 rounded-xl border border-line bg-page px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-2">
                      {CATEGORY_INFO[c].icon} {c === 'mortgage' ? 'Mortgage interest' : CATEGORY_INFO[c].label}
                    </span>
                    <input
                      defaultValue={targets[c] || ''}
                      onBlur={(e) => saveTarget(c, e.target.value)}
                      inputMode="decimal"
                      placeholder="—"
                      className="w-20 shrink-0 bg-transparent text-right text-sm font-semibold text-ink outline-none placeholder:text-ink-faint"
                    />
                    <span className="text-xs text-ink-muted">kr</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
        <button onClick={() => setEditingRules((v) => !v)} className="self-start text-[11px] font-medium text-ink-muted">
          {editingRules ? 'Done' : `Split rules · buffer ${formatKr(rules.bufferPerMonth)}/mo · amortization ${formatKr(rules.amortizationPerMonth)}/mo`}
        </button>
        {editingRules &&
          (
            [
              ['bufferPerMonth', '🛟 Buffer per month', 'The first part of what goes into savings; the rest counts as ETF & stocks.'],
              ['amortizationPerMonth', '🏠 Amortization per month', 'Of each mortgage payment; the rest counts as interest.'],
            ] as const
          ).map(([key, label, hint]) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="flex items-center gap-3 rounded-xl border border-line bg-page px-3 py-2">
                <span className="shrink-0 text-[13px] font-medium text-ink-2">{label}</span>
                <input
                  defaultValue={rules[key] || ''}
                  onBlur={(e) => saveRule(key, e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="min-w-0 flex-1 bg-transparent text-right text-sm font-semibold text-ink outline-none"
                />
                <span className="text-xs text-ink-muted">kr</span>
              </span>
              <span className="text-[11px] text-ink-muted">{hint}</span>
            </label>
          ))}
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
