import { useState } from 'react'
import { findOption, setOptionRows } from '../lib/optionStore'
import { patchOption } from '../lib/options'
import type { SettingKey } from '../lib/settings'
import type { OptionRow } from '../lib/editable'
import { useEdit } from '../contexts/EditContext'
import { ItemSheet } from './ItemMenu'

// The in-place editor for single values (kind 'setting'): in edit mode, a row of chips next to
// the feature they drive — "Sleep target · 8 h ✎" — each opening a small number sheet. Outside
// edit mode it renders nothing, so the screens look as they always did. NumberSheet is shared with
// values kept elsewhere (Journal's goal weight / step goal in user_settings).

const fmt = (v: number) => String(Math.round(v * 100) / 100)

export function SettingChips({ keys, className = '' }: { keys: SettingKey[]; className?: string }) {
  const { editing } = useEdit()
  const [open, setOpen] = useState<OptionRow | null>(null)
  if (!editing) return null
  const rows = keys.map((k) => findOption('setting', k)).filter((r): r is OptionRow => !!r)
  return (
    <div className={`flex flex-wrap gap-[7px] ${className}`}>
      {rows.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => setOpen(r)}
          className="rounded-full border border-dashed border-line-strong bg-surface px-3 py-1 text-xs font-medium text-ink-2"
        >
          {r.label} · <span className="font-semibold text-pine">{fmt(Number(r.meta.value))}</span>
          {/* ":00" sits right after the hour; other units get a space. */}
          {String(r.meta.unit ?? '').startsWith(':') ? '' : ' '}
          {String(r.meta.unit ?? '')} ✎
        </button>
      ))}
      {open && (
        <NumberSheet
          title={open.label}
          value={Number(open.meta.value)}
          min={Number(open.meta.min)}
          max={Number(open.meta.max)}
          step={Number(open.meta.step) || 1}
          unit={String(open.meta.unit ?? '')}
          onClose={() => setOpen(null)}
          onSave={async (value) => {
            const meta = { ...open.meta, value }
            await patchOption(open.id, { meta })
            setOptionRows((all) => all.map((r) => (r.id === open.id ? { ...r, meta } : r)))
          }}
        />
      )}
    </div>
  )
}

/** A one-number editor: validated against min/max, saved on "Save". */
export function NumberSheet({ title, value, min, max, step, unit, onSave, onClose, allowEmpty }: {
  title: string
  value: number | null
  min: number
  max: number
  step: number
  unit: string
  onSave: (value: number | null) => Promise<void>
  onClose: () => void
  /** Empty saves null (an optional goal); otherwise a number is required. */
  allowEmpty?: boolean
}) {
  const [raw, setRaw] = useState(value == null ? '' : fmt(value))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    const text = raw.trim().replace(',', '.')
    if (!text && allowEmpty) {
      setBusy(true)
      await onSave(null)
      onClose()
      return
    }
    const n = Number(text)
    if (!text || !Number.isFinite(n)) return setError('Type a number.')
    if (n < min || n > max) return setError(`Between ${fmt(min)} and ${fmt(max)}${unit ? ` ${unit}` : ''}.`)
    setBusy(true)
    try {
      await onSave(n)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <ItemSheet title={title} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2">
          <input
            autoFocus
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              save()
            }}
            inputMode="decimal"
            step={step}
            placeholder={allowEmpty ? 'Not set' : undefined}
            className="min-w-0 flex-1 rounded-[14px] border border-line bg-page px-3 py-2.5 text-lg font-semibold text-ink outline-none focus:border-pine"
          />
          <span className="text-sm text-ink-muted">{unit}</span>
        </label>
        {error && <p className="text-xs font-medium text-cat-rose-ink">{error}</p>}
        <button type="button" disabled={busy} onClick={save} className="rounded-[20px] bg-pine px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          Save
        </button>
      </div>
    </ItemSheet>
  )
}
