import { useState } from 'react'
import { useEdit } from '../contexts/EditContext'
import type { Tab } from './TabBar'

const ICONS: { id: Tab; icon: string; label: string }[] = [
  { id: 'calendar', icon: '📅', label: 'Calendar' },
]

// Calendar doesn't get its own slot in the bottom TabBar since it's used
// far less than the other tabs — it's reachable from this small icon row (there is no Settings
// page: everything is edited in place, ✎ below), 
// which sits inside every screen's pine hero block. Getting back to them from elsewhere
// in the app still just means tapping any bottom tab, same as before.
//
// Glass squares over the hero gradient; the active screen's square goes solid off-white
// with pine ink. Refresh rides along as a third square so no screen loses its reload.
export function TopIcons({
  active,
  onChange,
  onRefresh,
}: {
  active: Tab
  onChange: (tab: Tab) => void
  onRefresh?: () => Promise<void>
}) {
  const [spinning, setSpinning] = useState(false)
  const { editing, toggleEditing } = useEdit()

  async function refresh() {
    if (!onRefresh) return
    setSpinning(true)
    try {
      await onRefresh()
    } finally {
      setSpinning(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {/* Edit mode: shows the ⋯ on everything editable in place. Solid while on, like an active tab. */}
      <button
        onClick={toggleEditing}
        aria-label={editing ? 'Done editing' : 'Edit'}
        aria-pressed={editing}
        className={`flex h-[34px] w-[34px] items-center justify-center rounded-[12px] text-base leading-none transition ${
          editing ? 'bg-surface text-pine' : 'bg-white/14 text-white active:bg-white/25'
        }`}
      >
        ✎
      </button>
      {onRefresh && (
        <button
          onClick={refresh}
          disabled={spinning}
          aria-label="Refresh"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-[12px] bg-white/14 text-base leading-none text-white transition active:bg-white/25 disabled:opacity-60"
        >
          <span className={`inline-block ${spinning ? 'animate-spin' : ''}`}>↻</span>
        </button>
      )}
      {ICONS.map((item) => {
        const isActive = active === item.id
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            aria-label={item.label}
            className={`flex h-[34px] w-[34px] items-center justify-center rounded-[12px] text-base leading-none transition ${
              isActive ? 'bg-surface text-pine' : 'bg-white/14 text-white active:bg-white/25'
            }`}
          >
            {item.icon}
          </button>
        )
      })}
    </div>
  )
}
