import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/dates'
import { formatKr, potProgress, swapNeighbour, type PotCategory, type PotEntry, type SavingsPot } from '../lib/finance'
import { ChipRail } from './Screen'
import { ConfirmDialog } from './ConfirmDialog'

// Journal → Finance → Shopping list: things Pontus wants to buy, ranked in the order he wants
// them and grouped by his own categories. Same savings_pots rows as the first "Pots" version
// (target_amount = price, status 'done' = bought); putting money aside for an item is still
// possible but optional — without it this is just a prioritised list. Kept out of the
// long-term savings totals and goals on purpose.

const FIELD = 'min-w-0 rounded-xl border border-line bg-page px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-disabled focus:border-pine'
const parseKr = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'))
const byRank = (a: SavingsPot, b: SavingsPot) => a.rank - b.rank || a.id.localeCompare(b.id)

export function Pots() {
  const [items, setItems] = useState<SavingsPot[]>([])
  const [entries, setEntries] = useState<PotEntry[]>([])
  const [categories, setCategories] = useState<PotCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [creating, setCreating] = useState(false)
  const [emoji, setEmoji] = useState('🛍️')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [newCategory, setNewCategory] = useState<string | null>(null)
  const [editingCategories, setEditingCategories] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<SavingsPot | null>(null)
  const today = todayISO()

  async function load() {
    const [{ data: itemRows }, { data: entryRows }, { data: catRows }] = await Promise.all([
      supabase.from('savings_pots').select('*').order('rank').order('created_at'),
      supabase.from('pot_entries').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('pot_categories').select('id, name').order('name'),
    ])
    setItems(((itemRows ?? []) as SavingsPot[]).map((p) => ({ ...p, target_amount: Number(p.target_amount) })))
    setEntries(((entryRows ?? []) as PotEntry[]).map((e) => ({ ...e, amount: Number(e.amount) })))
    setCategories((catRows ?? []) as PotCategory[])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const active = items.filter((p) => p.status === 'active').sort(byRank)
  const bought = items.filter((p) => p.status === 'done')
  const catKey = (p: SavingsPot) => p.category_id ?? 'none'
  const shown = filter === 'all' ? active : active.filter((p) => catKey(p) === filter)
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? null
  const nextRank = () => Math.max(0, ...items.map((p) => p.rank)) + 1

  async function user() {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user
  }

  async function createItem(e: React.FormEvent) {
    e.preventDefault()
    const p = parseKr(price)
    const u = await user()
    if (!name.trim() || !(p > 0) || !u) return
    await supabase.from('savings_pots').insert({
      user_id: u.id,
      name: name.trim(),
      emoji: emoji.trim() || null,
      target_amount: p,
      category_id: categoryId || (filter !== 'all' && filter !== 'none' ? filter : null),
      rank: nextRank(),
    })
    setCreating(false)
    setName('')
    setPrice('')
    setEmoji('🛍️')
    load()
  }

  // Swap with the neighbour as shown, then renumber the whole active list 1..n so ranks never
  // tie (ties would make the next move a no-op). Only rows whose rank changed are written.
  async function move(item: SavingsPot, dir: -1 | 1) {
    const other = swapNeighbour(shown, item.id, dir)
    if (!other) return
    const order = active.map((p) => (p.id === item.id ? other : p.id === other.id ? item : p))
    const changed = order.map((p, i) => ({ p, rank: i + 1 })).filter(({ p, rank }) => p.rank !== rank)
    setItems((all) => all.map((p) => ({ ...p, rank: changed.find((c) => c.p.id === p.id)?.rank ?? p.rank })))
    await Promise.all(changed.map(({ p, rank }) => supabase.from('savings_pots').update({ rank }).eq('id', p.id)))
  }

  async function update(item: SavingsPot, patch: Partial<SavingsPot>) {
    setItems((all) => all.map((p) => (p.id === item.id ? { ...p, ...patch } : p)))
    await supabase.from('savings_pots').update(patch).eq('id', item.id)
  }

  async function addCategory() {
    const n = newCategory?.trim()
    const u = await user()
    if (!n || !u) return
    const { data } = await supabase.from('pot_categories').insert({ user_id: u.id, name: n }).select('id, name').single()
    if (data) setCategories((cs) => [...cs, data as PotCategory].sort((a, b) => a.name.localeCompare(b.name)))
    setNewCategory(null)
  }

  async function removeCategory(c: PotCategory) {
    // Items in it just lose the category (FK is on delete set null).
    setCategories((cs) => cs.filter((x) => x.id !== c.id))
    setItems((all) => all.map((p) => (p.category_id === c.id ? { ...p, category_id: null } : p)))
    if (filter === c.id) setFilter('all')
    await supabase.from('pot_categories').delete().eq('id', c.id)
  }

  async function save(item: SavingsPot, sign: 1 | -1) {
    const v = parseKr(amount)
    const u = await user()
    if (!(v > 0) || !u) return
    await supabase.from('pot_entries').insert({ user_id: u.id, pot_id: item.id, date: today, amount: sign * v })
    setAmount('')
    load()
  }

  async function removeItem(item: SavingsPot) {
    setConfirmDelete(null)
    setItems((all) => all.filter((p) => p.id !== item.id))
    await supabase.from('savings_pots').delete().eq('id', item.id)
  }

  if (loading) return <p className="text-sm text-ink-disabled">Loading…</p>

  const counts = new Map<string, number>()
  for (const p of active) counts.set(catKey(p), (counts.get(catKey(p)) ?? 0) + 1)
  const chipOptions = [
    { id: 'all', label: `All ${active.length}` },
    ...categories.map((c) => ({ id: c.id, label: `${c.name} ${counts.get(c.id) ?? 0}` })),
    ...(counts.has('none') ? [{ id: 'none', label: `No category ${counts.get('none')}` }] : []),
  ]
  const total = shown.reduce((s, p) => s + p.target_amount, 0)

  return (
    <>
      <ChipRail options={chipOptions} value={filter} onChange={setFilter} />
      <div className="-mt-1 flex items-center gap-3 px-1">
        {newCategory == null ? (
          <button onClick={() => setNewCategory('')} className="text-[11px] font-semibold text-pine">
            + Category
          </button>
        ) : (
          <span className="flex flex-1 items-center gap-2">
            <input autoFocus value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Watches" className={`${FIELD} flex-1 py-1.5`} />
            <button onClick={addCategory} disabled={!newCategory.trim()} className="rounded-lg bg-pine px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              Add
            </button>
            <button onClick={() => setNewCategory(null)} className="text-xs text-ink-3">
              Cancel
            </button>
          </span>
        )}
        {categories.length > 0 && newCategory == null && (
          <button onClick={() => setEditingCategories((v) => !v)} className="text-[11px] font-medium text-ink-3">
            {editingCategories ? 'Done' : 'Edit categories'}
          </button>
        )}
      </div>
      {editingCategories && (
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button key={c.id} onClick={() => removeCategory(c)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-2">
              {c.name} <span className="text-cat-rose-ink">✕</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-baseline justify-between px-1">
        <span className="text-[11px] font-semibold tracking-[0.1em] text-ink-3">
          {shown.length} ITEM{shown.length === 1 ? '' : 'S'} · IN PRIORITY ORDER
        </span>
        <span className="text-sm font-semibold text-ink">{formatKr(total)}</span>
      </div>

      {shown.length === 0 && <p className="-mt-1 px-1 text-sm text-ink-disabled">Nothing here yet.</p>}
      {shown.map((item, i) => {
        const pr = potProgress(item, entries, today)
        const open = openId === item.id
        const cat = catName(item.category_id)
        return (
          <div key={item.id} className="flex flex-col rounded-[20px] border border-line bg-surface shadow-card">
            <div className="flex items-center gap-2.5 py-2.5 pr-2 pl-3">
              <span className="w-5 shrink-0 text-center text-xs font-semibold text-ink-muted">{active.indexOf(item) + 1}</span>
              <button
                onClick={() => {
                  setOpenId(open ? null : item.id)
                  setAmount('')
                }}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-page text-lg">{item.emoji || '🛍️'}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold text-ink">{item.name}</span>
                  <span className="truncate text-[11px] text-ink-muted">
                    {cat ?? 'No category'}
                    {pr.saved > 0 ? ` · ${formatKr(pr.saved)} put aside` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-ink">{formatKr(item.target_amount)}</span>
              </button>
              <span className="flex shrink-0 flex-col">
                <button onClick={() => move(item, -1)} disabled={i === 0} aria-label="Move up" className="px-1.5 text-sm leading-tight text-ink-3 disabled:opacity-25">
                  ↑
                </button>
                <button onClick={() => move(item, 1)} disabled={i === shown.length - 1} aria-label="Move down" className="px-1.5 text-sm leading-tight text-ink-3 disabled:opacity-25">
                  ↓
                </button>
              </span>
            </div>
            {pr.saved > 0 && (
              <span className="mx-3 mb-2.5 block h-1.5 overflow-hidden rounded-full bg-[#ece5d7]">
                <span className="block h-full rounded-full bg-pine" style={{ width: `${Math.min(100, (pr.saved / item.target_amount) * 100)}%` }} />
              </span>
            )}

            {open && (
              <div className="flex flex-col gap-2.5 border-t border-line px-3.5 py-3">
                <label className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-ink-3">Category</span>
                  <select value={item.category_id ?? ''} onChange={(e) => update(item, { category_id: e.target.value || null })} className={`${FIELD} py-1.5`}>
                    <option value="">No category</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                {/* Optional: put money aside for this item. Never counts toward long-term savings. */}
                <div className="flex gap-2">
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Put aside, kr (optional)" className={`${FIELD} flex-1`} />
                  <button onClick={() => save(item, 1)} className="shrink-0 rounded-xl bg-track px-3 py-2 text-xs font-semibold text-ink-2">
                    Add
                  </button>
                  {pr.saved > 0 && (
                    <button onClick={() => save(item, -1)} className="shrink-0 rounded-xl bg-track px-3 py-2 text-xs font-semibold text-ink-2">
                      Take out
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between pt-0.5">
                  <button onClick={() => setConfirmDelete(item)} className="text-xs font-medium text-cat-rose-ink">
                    Delete
                  </button>
                  <button onClick={() => update(item, { status: 'done' })} className="rounded-full bg-pine px-3.5 py-1.5 text-xs font-semibold text-white">
                    ✓ Bought
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {creating ? (
        <form onSubmit={createItem} className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-surface p-3.5 shadow-card">
          <div className="flex gap-2">
            <input value={emoji} onChange={(e) => setEmoji(e.target.value)} aria-label="Emoji" className={`${FIELD} w-12 text-center text-lg`} />
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Engagement ring" className={`${FIELD} flex-1`} />
          </div>
          <div className="flex gap-2">
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="Price, kr" className={`${FIELD} flex-1`} />
            <select value={categoryId || (filter !== 'all' && filter !== 'none' ? filter : '')} onChange={(e) => setCategoryId(e.target.value)} className={`${FIELD} flex-1`}>
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[11px] font-medium text-ink-muted">Goes to the bottom of the list — move it up with the arrows.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCreating(false)} className="px-3 py-2 text-xs font-medium text-ink-3">
              Cancel
            </button>
            <button type="submit" disabled={!name.trim() || !(parseKr(price) > 0)} className="rounded-xl bg-pine px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
              Add to list
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setCreating(true)} className="rounded-[20px] border border-line-strong bg-surface py-[13px] text-sm font-semibold text-pine">
          + Add item
        </button>
      )}

      {bought.length > 0 && (
        <>
          <p className="pt-1 text-[11px] font-semibold tracking-[0.1em] text-ink-3">BOUGHT</p>
          <div className="-mt-1 overflow-hidden rounded-[20px] border border-line bg-surface">
            {bought.map((item, i) => (
              <div key={item.id} className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? 'border-t border-line' : ''}`}>
                <span className="text-lg">{item.emoji || '🛍️'}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-3 line-through">{item.name}</span>
                <span className="text-[13px] font-semibold text-ink-2">{formatKr(item.target_amount)}</span>
                <button onClick={() => update(item, { status: 'active', rank: nextRank() })} className="text-[11px] font-medium text-pine">
                  Back to list
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmDelete != null}
        title={`Delete "${confirmDelete?.name ?? ''}"?`}
        message="Removes it from the list for good. Use ✓ Bought instead to keep it in history."
        confirmLabel="Delete"
        onConfirm={() => confirmDelete && removeItem(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  )
}
