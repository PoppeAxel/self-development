import { useEffect, useState } from 'react'

// "− 4 Ett ägg +" under a grams field: counts an ingredient in its standard portion and writes
// the grams back. The count is read from the grams, so typing grams by hand moves it too; a
// count that isn't whole (175 g of 58 g eggs ≈ 3.02) steps to the next whole number. Below 1
// it steps in halves, so half an onion still works.

const fmt = (n: number) => String(Math.round(n * 100) / 100)

function stepUp(count: number) {
  if (count <= 0) return 1
  if (count < 1) return Math.floor(count * 2) / 2 + 0.5
  return Math.floor(count + 1e-9) + 1
}

function stepDown(count: number) {
  if (count <= 1) return Math.max(0, Math.ceil(count * 2 - 1e-9) / 2 - 0.5)
  return Math.ceil(count - 1e-9) - 1
}

export function PortionStepper({
  grams,
  portionGrams,
  label,
  onChange,
  size = 'sm',
}: {
  grams: string
  portionGrams: number
  label: string
  onChange: (grams: string) => void
  size?: 'sm' | 'md'
}) {
  const g = Number(grams)
  const count = grams.trim() !== '' && !Number.isNaN(g) && g > 0 ? g / portionGrams : 0
  // Typing "1." or clearing the field shouldn't snap back mid-edit, so the field keeps its own
  // text while focused and only follows the grams otherwise.
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => setDraft(null), [portionGrams])

  const set = (n: number) => onChange(n > 0 ? fmt(n * portionGrams) : '')
  const pad = size === 'md' ? 'py-2' : 'py-1.5'

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => set(stepDown(count))}
        disabled={count <= 0}
        className={`w-11 shrink-0 rounded-xl bg-track ${pad} text-base font-semibold leading-none text-ink-2 disabled:opacity-40`}
        aria-label={`One less ${label}`}
      >
        −
      </button>
      <label className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-track px-2 ${pad} text-xs font-medium text-ink-2`}>
        <input
          value={draft ?? (count > 0 ? fmt(count) : '')}
          onFocus={(e) => {
            setDraft(e.target.value)
            e.target.select()
          }}
          onBlur={() => setDraft(null)}
          onChange={(e) => {
            setDraft(e.target.value)
            const n = Number(e.target.value.replace(',', '.'))
            if (e.target.value.trim() === '') onChange('')
            else if (!Number.isNaN(n) && n >= 0) set(n)
          }}
          type="text"
          inputMode="decimal"
          placeholder="0"
          aria-label={`Number of ${label}`}
          className="w-9 min-w-0 rounded-lg bg-surface py-0.5 text-center text-sm font-semibold text-ink outline-none focus:ring-1 focus:ring-pine"
        />
        <span className="truncate">{label}</span>
      </label>
      <button
        type="button"
        onClick={() => set(stepUp(count))}
        className={`w-11 shrink-0 rounded-xl bg-track ${pad} text-base font-semibold leading-none text-ink-2`}
        aria-label={`One more ${label}`}
      >
        +
      </button>
    </div>
  )
}
