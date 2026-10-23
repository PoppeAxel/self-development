import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { ACCOUNT_INFO, BUFFER_ACCOUNTS, SAVINGS_ACCOUNTS, formatKr, type BufferAccount } from '../lib/finance'
import { loadBudgetRules } from '../lib/bankSavings'
import {
  CARD_SUBS,
  CATEGORY_INFO,
  HEADS,
  NO_RULES,
  PLANNABLE,
  categoryInfo,
  daysLeft,
  decodeCsv,
  guessCategory,
  headOf,
  headRows,
  merchantKey,
  parseNordeaCsv,
  payMonthOf,
  payPeriod,
  periodBudget,
  planRows,
  shiftMonth,
  type BankTransaction,
  type BudgetCategory,
  type BudgetTargets,
  type HeadId,
  type PlanRow,
  type SplitRules,
} from '../lib/budget'

// Economy → Budget / Plan: import Nordea's CSV export (no bank API), see income, saved, fixed
// costs, variable spending and left over per pay period (salary day → day before the next),
// spending by head category (tap one for its subcategories), each against its monthly plan.
// Categories are guessed on import; changing one applies to every transaction from that
// merchant and to future imports — no rules to maintain.

// The transaction picker: the special categories around each head's subcategories.
const PICKER: { label: string; options: BudgetCategory[] }[] = [
  { label: 'Income', options: ['income'] },
  { label: 'Saved', options: ['savings'] },
  { label: 'Spending card', options: ['card'] },
  ...HEADS.map((h) => ({ label: `${h.icon} ${h.label}`, options: [...h.subs] as BudgetCategory[] })),
  { label: 'Shared', options: ['shared'] },
  { label: 'Ignored', options: ['transfer'] },
]

/** A small F / V tag: is this subcategory a fixed cost or variable spending? */
function FixedTag({ category }: { category: BudgetCategory }) {
  const fixed = CATEGORY_INFO[category].group === 'fixed'
  return (
    <span className={`shrink-0 rounded px-1 text-[9px] font-semibold ${fixed ? 'bg-cat-sky-tint text-cat-sky-ink' : 'bg-page text-ink-muted'}`} title={fixed ? 'Fixed cost' : 'Variable'}>
      {fixed ? 'FIXED' : 'VAR'}
    </span>
  )
}

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

/** `actual` = import, what happened, transactions. `plan` = each category against its monthly target. */
export function Budget({ view }: { view: 'actual' | 'plan' }) {
  // The calendar month whose salary opens the period shown.
  const [month, setMonth] = useState(payMonthOf(format(new Date(), 'yyyy-MM-dd')))
  // This month and the next — enough to find both paydays around the period.
  const [loaded, setLoaded] = useState<BankTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [rules, setRules] = useState<SplitRules>(NO_RULES)
  const [editingRules, setEditingRules] = useState(false)
  const [targets, setTargets] = useState<BudgetTargets>({})
  const [editingPlan, setEditingPlan] = useState(false)
  // Head categories expanded to show their subcategories.
  const [openHeads, setOpenHeads] = useState<Set<HeadId>>(new Set())
  const toggleHead = (h: HeadId) =>
    setOpenHeads((s) => {
      const next = new Set(s)
      if (next.has(h)) next.delete(h)
      else next.add(h)
      return next
    })

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

  async function saveCardSplit(sub: (typeof CARD_SUBS)[number], raw: string) {
    const value = Number(raw.replace(/\s/g, '').replace(',', '.') || 0)
    if (!Number.isFinite(value) || value < 0 || value === (rules.card[sub] ?? 0)) return
    const card = { ...rules.card, [sub]: value }
    setRules({ ...rules, card })
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('user_settings').upsert({ user_id: user.id, budget_card_split: card })
  }

  async function saveRule(key: BufferAccount | 'amortization', raw: string) {
    const value = Number(raw.replace(/\s/g, '').replace(',', '.') || 0)
    const current = key === 'amortization' ? rules.amortizationPerMonth : rules.buffers[key]
    if (!Number.isFinite(value) || value < 0 || value === current) return
    const next: SplitRules = key === 'amortization' ? { ...rules, amortizationPerMonth: value } : { ...rules, buffers: { ...rules.buffers, [key]: value } }
    setRules(next)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase
      .from('user_settings')
      .upsert(key === 'amortization' ? { user_id: user.id, mortgage_amortization_per_month: value } : { user_id: user.id, budget_savings_split: next.buffers })
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
  const plan = planRows(b, targets)
  const planned = PLANNABLE.reduce((s, c) => s + (targets[c] ?? 0), 0)
  // Only categories with a plan count here — unplanned spending would make "of planned" lie.
  const plannedSpent = plan.filter((r) => r.target != null).reduce((s, r) => s + r.actual, 0)
  const remainingDays = daysLeft(format(new Date(), 'yyyy-MM-dd'), end, start)
  const day = (iso: string) => format(new Date(iso + 'T00:00:00'), 'd MMM')
  const step = (n: number) => setMonth(shiftMonth(month, n))

  // "1 200 kr" or "1 200 kr / 5 000 kr"; money back reads "+300 kr back".
  const amountText = (actual: number, target: number | null, over: boolean) => (
    <span className={`shrink-0 font-semibold ${over ? 'text-cat-rose-ink' : actual < 0 ? 'text-pine' : 'text-ink'}`}>
      {actual < 0 ? `+${formatKr(-actual)} back` : formatKr(actual)}
      {target != null && <span className="font-medium text-ink-muted"> / {formatKr(target)}</span>}
    </span>
  )

  // One bar per head category (collapsed); tap it for its subcategories, each tagged fixed or
  // variable. With targets: "actual / target", a bar of the target that turns rose when over,
  // and what's left. Without: a bar relative to the biggest head.
  const headSections = (rows: PlanRow[]) => {
    const heads = headRows(rows)
    if (!heads.length) return null
    const maxHead = Math.max(...heads.map((h) => h.actual), 1)
    return (
      <div className="flex flex-col gap-3">
        <p className="mt-1 text-[11px] font-semibold tracking-[0.1em] text-ink-3">BY CATEGORY</p>
        {heads.map(({ head, actual, target, subs }) => {
          const info = headOf(head)
          const over = target != null && actual > target
          const width = target != null ? Math.min(Math.max(actual, 0) / target, 1) : Math.max(actual, 0) / maxHead
          const open = openHeads.has(head)
          return (
            <div key={head} className="flex flex-col gap-1">
              <button onClick={() => toggleHead(head)} className="flex flex-col gap-1 text-left" aria-expanded={open}>
                <span className="flex w-full items-baseline justify-between gap-2 text-[13px]">
                  <span className="min-w-0 truncate font-medium text-ink-2">
                    {info.icon} {info.label} <span className="text-[10px] text-ink-faint">{open ? '▲' : '▼'}</span>
                  </span>
                  {amountText(actual, target, over)}
                </span>
                <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[#ece5d7]">
                  <span className="block h-full rounded-full" style={{ width: `${width * 100}%`, background: over ? 'var(--color-cat-rose)' : info.color }} />
                </span>
                {target != null && (
                  <span className={`text-[11px] ${over ? 'font-medium text-cat-rose-ink' : 'text-ink-muted'}`}>
                    {over ? `${formatKr(actual - target)} over` : `${formatKr(target - actual)} left`}
                  </span>
                )}
              </button>
              {open && (
                <div className="ml-6 flex flex-col gap-1.5 border-l border-line pl-3 pt-1">
                  {subs.map((s) => (
                    <div key={s.category} className="flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="flex min-w-0 items-center gap-1.5 text-ink-3">
                        <span className="truncate">{CATEGORY_INFO[s.category].label}</span>
                        <FixedTag category={s.category} />
                      </span>
                      {amountText(s.actual, s.target, s.target != null && s.actual > s.target)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <>
      {/* Import */}
      {view === 'actual' && (
      <>
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
      </>
      )}

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

      {view === 'plan' ? (
        <div className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-surface p-3.5 shadow-card">
          {planned > 0 ? (
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold tracking-[0.06em] text-ink-3">PLANNED</span>
              <span className={`text-xl font-semibold ${plannedSpent > planned ? 'text-cat-rose-ink' : 'text-ink'}`}>
                {formatKr(plannedSpent)}
                <span className="text-sm font-medium text-ink-muted"> / {formatKr(planned)}</span>
              </span>
            </div>
          ) : (
            <p className="text-sm text-ink-3">No plan yet. Set what you mean to spend per pay period, and each category shows how much of it is used.</p>
          )}
          {planned > 0 && remainingDays != null && (
            <p className="-mt-1.5 text-[11px] font-medium text-ink-muted">
              {remainingDays} {remainingDays === 1 ? 'day' : 'days'} left · {formatKr(Math.max(planned - plannedSpent, 0))} left to spend in planned categories
            </p>
          )}
          {headSections(plan)}
          <button
            onClick={() => setEditingPlan((v) => !v)}
            className="mt-1 rounded-xl border border-line bg-page py-2 text-[13px] font-semibold text-pine"
          >
            {editingPlan ? 'Done' : planned > 0 ? '✏️ Edit monthly plan' : '✏️ Plan your month'}
          </button>
          {editingPlan && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] text-ink-muted">What you plan to spend per pay period. Leave a category empty for no plan.</p>
              {HEADS.map((h) => (
                <div key={h.id} className="flex flex-col gap-1.5">
                  <p className="mt-1 text-[11px] font-semibold tracking-[0.06em] text-ink-3">
                    {h.icon} {h.label.toUpperCase()}
                  </p>
                  {PLANNABLE.filter((c) => CATEGORY_INFO[c].head === h.id).map((c) => (
                    <label key={c} className="flex items-center gap-2 rounded-xl border border-line bg-page px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-2">{CATEGORY_INFO[c].label}</span>
                      <FixedTag category={c} />
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
        </div>
      ) : (
      <>
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
        {headSections(planRows(b, {}))}
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
        <button onClick={() => setEditingRules((v) => !v)} className="self-start text-[11px] font-medium text-ink-muted">
          {editingRules
            ? 'Done'
            : `Split rules · buffers ${formatKr(BUFFER_ACCOUNTS.reduce((s, a) => s + rules.buffers[a], 0))} · card ${formatKr(CARD_SUBS.reduce((s, c) => s + (rules.card[c] ?? 0), 0))} · amortization ${formatKr(rules.amortizationPerMonth)}`}
        </button>
        {editingRules && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] text-ink-muted">Each pay period, what goes into savings fills these buffers in order; the rest counts as 📈 ETF & stocks.</p>
            {[...BUFFER_ACCOUNTS, 'amortization' as const].map((key) => (
              <label key={key} className="flex items-center gap-3 rounded-xl border border-line bg-page px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-2">
                  {key === 'amortization' ? '🏠 Amortization (of each mortgage payment)' : `${ACCOUNT_INFO[key].icon} ${ACCOUNT_INFO[key].label}`}
                </span>
                <input
                  defaultValue={(key === 'amortization' ? rules.amortizationPerMonth : rules.buffers[key]) || ''}
                  onBlur={(e) => saveRule(key, e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-20 shrink-0 bg-transparent text-right text-sm font-semibold text-ink outline-none"
                />
                <span className="text-xs text-ink-muted">kr</span>
              </label>
            ))}
            <p className="mt-2 text-[11px] text-ink-muted">
              💳 Revolut card: each pay period, top-ups count as spent on these, in order; anything above them counts as Other.
            </p>
            {CARD_SUBS.map((c) => (
              <label key={c} className="flex items-center gap-3 rounded-xl border border-line bg-page px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-2">
                  {CATEGORY_INFO[c].icon} {CATEGORY_INFO[c].label}
                </span>
                <input
                  defaultValue={rules.card[c] || ''}
                  onBlur={(e) => saveCardSplit(c, e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-20 shrink-0 bg-transparent text-right text-sm font-semibold text-ink outline-none"
                />
                <span className="text-xs text-ink-muted">kr</span>
              </label>
            ))}
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
              <span className="text-base">{categoryInfo(t.category).icon}</span>
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
                    {PICKER.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.options.map((c) => (
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
      )}
    </>
  )
}
