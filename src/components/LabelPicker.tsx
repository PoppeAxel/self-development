import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { CATEGORY_COLOR_LABELS, CATEGORY_STYLES } from '../lib/categories'
import { byPosition, copyName, moveItem, nameProblem, renumber } from '../lib/editable'
import { CATEGORY_COLORS, type Category, type CategoryColor } from '../lib/types'
import { useEdit } from '../contexts/EditContext'
import { ConfirmDialog } from './ConfirmDialog'
import { EditDots, ItemSheet, useLongPress } from './ItemMenu'

// The label picker used wherever a task or goal gets a label (Today's task form, Calendar,
// the goal form, GoalDetail's ⋯). It's also where labels are managed: + New label, and in
// edit mode (or on long-press) each chip opens its sheet — rename, colour, duplicate,
// reorder, delete. There is no separate labels screen.
//
// `labels` is every row INCLUDING archived ones, so pages can still name a task whose label
// was deleted; the picker itself only offers the live ones.

export const liveLabels = (labels: Category[]) => labels.filter((l) => !l.archived_at).sort(byPosition)

export function LabelPicker({
  labels,
  setLabels,
  value,
  onChange,
  onRefsChanged,
}: {
  labels: Category[]
  setLabels: React.Dispatch<React.SetStateAction<Category[]>>
  value: string | null
  onChange: (id: string | null) => void
  /** Tasks/goals were moved to another label (delete or its undo) — reload what shows them. */
  onRefsChanged?: () => void
}) {
  const { editing } = useEdit()
  const [sheet, setSheet] = useState<Category | 'new' | null>(null)
  const live = liveLabels(labels)

  return (
    <div className="flex flex-wrap gap-[7px]">
      <Chip name="No label" active={value === null} onClick={() => onChange(null)} />
      {live.map((l) => (
        <Chip
          key={l.id}
          name={l.name}
          dot={CATEGORY_STYLES[l.color].accent}
          active={value === l.id}
          onClick={() => onChange(l.id)}
          onEdit={editing ? () => setSheet(l) : undefined}
          onLongPress={() => setSheet(l)}
        />
      ))}
      <button
        type="button"
        onClick={() => setSheet('new')}
        className="rounded-full border border-dashed border-line-strong px-3.5 py-2 text-xs font-medium text-pine"
      >
        + New label
      </button>
      {sheet && (
        <LabelSheet
          label={sheet === 'new' ? null : sheet}
          labels={labels}
          setLabels={setLabels}
          value={value}
          onChange={onChange}
          onRefsChanged={onRefsChanged}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}

function Chip({ name, dot, active, onClick, onEdit, onLongPress }: {
  name: string
  dot?: string
  active: boolean
  onClick: () => void
  onEdit?: () => void
  onLongPress?: () => void
}) {
  const press = useLongPress(onLongPress ?? (() => {}))
  return (
    <span
      className={`flex select-none items-center gap-1.5 rounded-full text-xs [-webkit-touch-callout:none] ${onEdit ? 'pr-1.5' : ''} ${active ? 'bg-pine font-semibold text-white' : 'border border-line bg-surface font-medium text-ink-2'}`}
    >
      <button type="button" onClick={onClick} {...(onLongPress ? press : {})} className={`flex items-center gap-1.5 py-2 pl-3.5 ${onEdit ? 'pr-0.5' : 'pr-3.5'}`}>
        {dot && <span className="h-2 w-2 rounded-full" style={{ background: active ? '#fff' : dot }} />}
        {name}
      </button>
      {onEdit && <EditDots onClick={onEdit} label={name} />}
    </span>
  )
}

function LabelSheet({ label, labels, setLabels, value, onChange, onRefsChanged, onClose }: {
  label: Category | null
  labels: Category[]
  setLabels: React.Dispatch<React.SetStateAction<Category[]>>
  value: string | null
  onChange: (id: string | null) => void
  onRefsChanged?: () => void
  onClose: () => void
}) {
  const { offerUndo } = useEdit()
  const live = liveLabels(labels)
  // A new label gets a colour no live label uses yet, so two labels don't look the same.
  const freeColor = CATEGORY_COLORS.find((c) => !live.some((l) => l.color === c)) ?? CATEGORY_COLORS[0]
  const [name, setName] = useState(label?.name ?? '')
  const [color, setColor] = useState<CategoryColor>(label?.color ?? freeColor)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Delete flow: null = not deleting; usage = which tasks/goals still carry this label.
  const [usage, setUsage] = useState<{ taskIds: string[]; goalIds: string[] } | null>(null)
  const [moveTo, setMoveTo] = useState<string | null>(null)
  const [confirmPlain, setConfirmPlain] = useState(false)

  const index = label ? live.findIndex((l) => l.id === label.id) : -1

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function writePositions(ordered: Category[]) {
    const { list, changed } = renumber(ordered)
    const pos = new Map(list.map((l) => [l.id, l.position]))
    setLabels((all) => all.map((l) => (pos.has(l.id) ? { ...l, position: pos.get(l.id)! } : l)))
    await Promise.all(changed.map((l) => supabase.from('categories').update({ position: l.position }).eq('id', l.id).throwOnError()))
  }

  const save = () =>
    run(async () => {
      const others = labels.filter((l) => l.id !== label?.id)
      // Re-creating a deleted label's name brings that label back rather than colliding with it.
      const archivedTwin = !label ? others.find((l) => l.archived_at && l.name.toLowerCase() === name.trim().toLowerCase()) : undefined
      const problem = nameProblem(name, others.filter((l) => l !== archivedTwin).map((l) => l.name))
      if (problem) return setError(problem)
      const n = name.trim()
      if (label) {
        await supabase.from('categories').update({ name: n, color }).eq('id', label.id).throwOnError()
        setLabels((all) => all.map((l) => (l.id === label.id ? { ...l, name: n, color } : l)))
      } else if (archivedTwin) {
        const patch = { name: n, color, archived_at: null, position: live.length }
        await supabase.from('categories').update(patch).eq('id', archivedTwin.id).throwOnError()
        setLabels((all) => all.map((l) => (l.id === archivedTwin.id ? { ...l, ...patch } : l)))
        onChange(archivedTwin.id)
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return setError('Not signed in.')
        const { data } = await supabase.from('categories').insert({ user_id: user.id, name: n, color, position: live.length }).select().single().throwOnError()
        setLabels((all) => [...all, data as Category])
        onChange((data as Category).id)
      }
      onClose()
    })

  const duplicate = () =>
    run(async () => {
      if (!label) return
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const copy = copyName(label.name, labels.map((l) => l.name))
      const { data } = await supabase.from('categories').insert({ user_id: user.id, name: copy, color: label.color, position: label.position }).select().single().throwOnError()
      const created = data as Category
      setLabels((all) => [...all, created])
      const ordered = [...live]
      ordered.splice(index + 1, 0, created)
      await writePositions(ordered)
      onClose()
    })

  const move = (dir: -1 | 1) => run(() => (label ? writePositions(moveItem(live, label.id, dir)) : Promise.resolve()))

  const startDelete = () =>
    run(async () => {
      if (!label) return
      const [{ data: t }, { data: g }] = await Promise.all([
        supabase.from('daily_tasks').select('id').eq('category_id', label.id).throwOnError(),
        supabase.from('goals').select('id').eq('category_id', label.id).throwOnError(),
      ])
      const taskIds = (t ?? []).map((r) => r.id as string)
      const goalIds = (g ?? []).map((r) => r.id as string)
      if (taskIds.length + goalIds.length === 0) setConfirmPlain(true)
      else setUsage({ taskIds, goalIds })
    })

  const doDelete = () =>
    run(async () => {
      if (!label) return
      const { taskIds, goalIds } = usage ?? { taskIds: [], goalIds: [] }
      const target = usage ? moveTo : null
      if (taskIds.length) await supabase.from('daily_tasks').update({ category_id: target }).in('id', taskIds).throwOnError()
      if (goalIds.length) await supabase.from('goals').update({ category_id: target }).in('id', goalIds).throwOnError()
      const archivedAt = new Date().toISOString()
      await supabase.from('categories').update({ archived_at: archivedAt }).eq('id', label.id).throwOnError()
      setLabels((all) => all.map((l) => (l.id === label.id ? { ...l, archived_at: archivedAt } : l)))
      if (value === label.id) onChange(target)
      onClose()
      if (taskIds.length || goalIds.length) onRefsChanged?.()
      offerUndo(`Deleted “${label.name}”`, async () => {
        await supabase.from('categories').update({ archived_at: null }).eq('id', label.id).throwOnError()
        if (taskIds.length) await supabase.from('daily_tasks').update({ category_id: label.id }).in('id', taskIds).throwOnError()
        if (goalIds.length) await supabase.from('goals').update({ category_id: label.id }).in('id', goalIds).throwOnError()
        setLabels((all) => all.map((l) => (l.id === label.id ? { ...l, archived_at: null } : l)))
        if (taskIds.length || goalIds.length) onRefsChanged?.()
      })
    })

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

  return (
    <>
      <ItemSheet
        title={label ? 'Edit label' : 'New label'}
        onClose={onClose}
        onDuplicate={label && !usage ? duplicate : undefined}
        onMoveUp={label && !usage && index > 0 ? () => move(-1) : undefined}
        onMoveDown={label && !usage && index < live.length - 1 ? () => move(1) : undefined}
        onDelete={label && !usage ? startDelete : undefined}
      >
        {usage && label ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-2">
              “{label.name}” is on{' '}
              {[usage.taskIds.length && plural(usage.taskIds.length, 'task'), usage.goalIds.length && plural(usage.goalIds.length, 'goal')].filter(Boolean).join(' and ')}.
              What should they get instead?
            </p>
            <div className="flex flex-wrap gap-[7px]">
              <Chip name="No label" active={moveTo === null} onClick={() => setMoveTo(null)} />
              {live
                .filter((l) => l.id !== label.id)
                .map((l) => (
                  <Chip key={l.id} name={l.name} dot={CATEGORY_STYLES[l.color].accent} active={moveTo === l.id} onClick={() => setMoveTo(l.id)} />
                ))}
            </div>
            {error && <p className="text-xs font-medium text-cat-rose-ink">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setUsage(null)} className="flex-1 rounded-[20px] bg-track px-4 py-2.5 text-sm font-medium text-ink-2">
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={doDelete} className="flex-1 rounded-[20px] bg-cat-rose px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                Delete label
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <input
              autoFocus={!label}
              value={name}
              maxLength={30}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                // The picker often sits inside a <form> (Today's task form) — Enter must not submit it.
                if (e.key !== 'Enter') return
                e.preventDefault()
                save()
              }}
              placeholder="Label name"
              className="rounded-[14px] border border-line bg-page px-3 py-2.5 text-sm font-medium text-ink outline-none placeholder:text-ink-faint focus:border-pine"
            />
            <div className="flex items-center gap-2.5">
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={CATEGORY_COLOR_LABELS[c]}
                  aria-pressed={color === c}
                  className={`h-7 w-7 rounded-full ${color === c ? 'ring-2 ring-ink ring-offset-2' : ''}`}
                  style={{ background: CATEGORY_STYLES[c].accent }}
                />
              ))}
            </div>
            {error && <p className="text-xs font-medium text-cat-rose-ink">{error}</p>}
            <button type="button" disabled={busy} onClick={save} className="rounded-[20px] bg-pine px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {label ? 'Save' : 'Add label'}
            </button>
          </div>
        )}
      </ItemSheet>
      <ConfirmDialog
        open={confirmPlain}
        title={`Delete “${label?.name}”?`}
        message="No task or goal uses it. You can undo for a few seconds."
        confirmLabel="Delete"
        onCancel={() => setConfirmPlain(false)}
        onConfirm={() => {
          setConfirmPlain(false)
          doDelete()
        }}
      />
    </>
  )
}
