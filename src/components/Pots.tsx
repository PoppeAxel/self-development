import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/dates'
import { formatKr, potProgress, type PotEntry, type SavingsPot } from '../lib/finance'
import { ConfirmDialog } from './ConfirmDialog'

// Journal → Finance → Pots: short-term saving for one thing (a ring, a watch, a trip).
// Its own tables (savings_pots / pot_entries) so pot money never counts toward the
// long-term totals or a 'savings' goal — buying the ring doesn't dent those.

const FIELD = 'min-w-0 rounded-xl border border-line bg-page px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-disabled focus:border-pine'
const parseKr = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'))

export function Pots() {
  const [pots, setPots] = useState<SavingsPot[]>([])
  const [entries, setEntries] = useState<PotEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [emoji, setEmoji] = useState('🎯')
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<SavingsPot | null>(null)
  const today = todayISO()

  async function load() {
    const [{ data: potRows }, { data: entryRows }] = await Promise.all([
      supabase.from('savings_pots').select('*').order('created_at'),
      supabase.from('pot_entries').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }),
    ])
    setPots(((potRows ?? []) as SavingsPot[]).map((p) => ({ ...p, target_amount: Number(p.target_amount) })))
    setEntries(((entryRows ?? []) as PotEntry[]).map((e) => ({ ...e, amount: Number(e.amount) })))
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function createPot(e: React.FormEvent) {
    e.preventDefault()
    const t = parseKr(target)
    if (!name.trim() || !(t > 0)) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('savings_pots').insert({ user_id: user.id, name: name.trim(), emoji: emoji.trim() || null, target_amount: t, target_date: targetDate || null })
    setCreating(false)
    setName('')
    setTarget('')
    setTargetDate('')
    setEmoji('🎯')
    load()
  }

  async function move(pot: SavingsPot, sign: 1 | -1) {
    const v = parseKr(amount)
    if (!(v > 0)) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('pot_entries').insert({ user_id: user.id, pot_id: pot.id, date: today, amount: sign * v })
    setAmount('')
    load()
  }

  async function setStatus(pot: SavingsPot, status: SavingsPot['status']) {
    setOpenId(null)
    setPots((ps) => ps.map((p) => (p.id === pot.id ? { ...p, status } : p)))
    await supabase.from('savings_pots').update({ status }).eq('id', pot.id)
  }

  async function removeEntry(entry: PotEntry) {
    setEntries((es) => es.filter((e) => e.id !== entry.id))
    await supabase.from('pot_entries').delete().eq('id', entry.id)
  }

  async function removePot(pot: SavingsPot) {
    setConfirmDelete(null)
    setPots((ps) => ps.filter((p) => p.id !== pot.id))
    await supabase.from('savings_pots').delete().eq('id', pot.id)
  }

  const active = pots.filter((p) => p.status === 'active')
  const done = pots.filter((p) => p.status === 'done')
  const inPots = active.reduce((s, p) => s + potProgress(p, entries, today).saved, 0)

  if (loading) return <p className="text-sm text-ink-disabled">Loading…</p>

  return (
    <>
      <div className="flex items-baseline justify-between rounded-[20px] border border-line bg-surface px-4 py-3 shadow-card">
        <span className="text-xs font-semibold tracking-[0.06em] text-ink-3">IN POTS</span>
        <span className="text-xl font-semibold text-ink">{formatKr(inPots)}</span>
      </div>
      <p className="-mt-1.5 px-1 text-[11px] font-medium text-ink-muted">Kept apart from your long-term savings and goals.</p>

      {active.map((pot) => {
        const pr = potProgress(pot, entries, today)
        const pct = Math.min(100, (pr.saved / pot.target_amount) * 100)
        const open = openId === pot.id
        const potEntries = entries.filter((e) => e.pot_id === pot.id)
        const line =
          pr.remaining === 0
            ? 'Target reached — mark it done when you buy it'
            : pot.target_date && pr.perMonth != null
              ? `by ${format(new Date(pot.target_date + 'T00:00:00'), 'MMM yyyy')} · ${formatKr(pr.perMonth)}/month to make it`
              : `${formatKr(pr.remaining)} to go`
        return (
          <div key={pot.id} className="flex flex-col rounded-[20px] border border-line bg-surface shadow-card">
            <button
              onClick={() => {
                setOpenId(open ? null : pot.id)
                setAmount('')
              }}
              className="flex flex-col gap-2 px-4 py-3 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-page text-xl">{pot.emoji || '🎯'}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-semibold text-ink">{pot.name}</span>
                  <span className="text-xs text-ink-muted">
                    {formatKr(pr.saved)} of {formatKr(pot.target_amount)}
                  </span>
                </span>
                <span className="shrink-0 text-[15px] font-semibold text-pine">{Math.round(pct)}%</span>
              </div>
              <span className="block h-[7px] overflow-hidden rounded-full bg-[#ece5d7]">
                <span className="block h-full rounded-full bg-pine" style={{ width: `${pct}%` }} />
              </span>
              <span className="text-[11px] font-medium text-ink-2">{line}</span>
            </button>

            {open && (
              <div className="flex flex-col gap-2.5 border-t border-line px-4 py-3">
                <div className="flex gap-2">
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount, kr" className={`${FIELD} flex-1`} />
                  <button onClick={() => move(pot, 1)} className="shrink-0 rounded-xl bg-pine px-3.5 py-2 text-xs font-semibold text-white">
                    Add
                  </button>
                  <button onClick={() => move(pot, -1)} className="shrink-0 rounded-xl bg-track px-3.5 py-2 text-xs font-semibold text-ink-2">
                    Take out
                  </button>
                </div>
                {potEntries.slice(0, 5).map((e) => (
                  <div key={e.id} className="flex items-center gap-3 text-[13px]">
                    <span className="flex-1 text-ink-3">{format(new Date(e.date + 'T00:00:00'), 'd MMM yyyy')}</span>
                    <span className={`font-semibold ${e.amount < 0 ? 'text-cat-rose-ink' : 'text-ink'}`}>
                      {e.amount > 0 ? '+' : '−'}
                      {formatKr(Math.abs(e.amount))}
                    </span>
                    <button onClick={() => removeEntry(e)} className="text-ink-faint" aria-label="Delete entry">
                      ✕
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1">
                  <button onClick={() => setConfirmDelete(pot)} className="text-xs font-medium text-cat-rose-ink">
                    Delete pot
                  </button>
                  <button onClick={() => setStatus(pot, 'done')} className="rounded-full bg-page px-3 py-1.5 text-xs font-semibold text-pine">
                    ✓ Mark as done
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {creating ? (
        <form onSubmit={createPot} className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-surface p-3.5 shadow-card">
          <div className="flex gap-2">
            <input value={emoji} onChange={(e) => setEmoji(e.target.value)} aria-label="Emoji" className={`${FIELD} w-12 text-center text-lg`} />
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Engagement ring" className={`${FIELD} flex-1`} />
          </div>
          <div className="flex gap-2">
            <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" placeholder="Target, kr" className={`${FIELD} flex-1`} />
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} aria-label="Target date (optional)" className={`${FIELD} flex-1`} />
          </div>
          <p className="text-[11px] font-medium text-ink-muted">The date is optional — with one, the pot tells you what to put in each month.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCreating(false)} className="px-3 py-2 text-xs font-medium text-ink-3">
              Cancel
            </button>
            <button type="submit" disabled={!name.trim() || !(parseKr(target) > 0)} className="rounded-xl bg-pine px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
              Create pot
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setCreating(true)} className="rounded-[20px] border border-line-strong bg-surface py-[13px] text-sm font-semibold text-pine">
          + New pot
        </button>
      )}

      {done.length > 0 && (
        <>
          <p className="pt-1 text-[11px] font-semibold tracking-[0.1em] text-ink-3">DONE</p>
          <div className="-mt-1 overflow-hidden rounded-[20px] border border-line bg-surface">
            {done.map((pot, i) => (
              <div key={pot.id} className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? 'border-t border-line' : ''}`}>
                <span className="text-lg">{pot.emoji || '🎯'}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-3">{pot.name}</span>
                <span className="text-[13px] font-semibold text-ink-2">{formatKr(potProgress(pot, entries, today).saved)}</span>
                <button onClick={() => setStatus(pot, 'active')} className="text-[11px] font-medium text-pine">
                  Reopen
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmDelete != null}
        title={`Delete "${confirmDelete?.name ?? ''}"?`}
        message="The pot and everything logged in it are removed. Use Mark as done instead to keep it in history."
        confirmLabel="Delete"
        onConfirm={() => confirmDelete && removePot(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  )
}
