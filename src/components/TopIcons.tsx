import { useState } from 'react'
import type { Tab } from './TabBar'

const ICONS: { id: Tab; icon: string; label: string }[] = [
  { id: 'calendar', icon: '📅', label: 'Calendar' },
  { id: 'settings', icon: '⚙', label: 'Settings' },
]

// Calendar and Settings don't get their own slot in the bottom TabBar since they're used
// far less than the other tabs — instead they're reachable from this small icon row,
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
      {onRefresh && (
        <button
          onClick={refresh}
          disabled={spinning}
          aria-label="Refresh"
          className="flex h-[38px] w-[38px] items-center justify-center rounded-[14px] bg-white/14 text-base leading-none text-white transition active:bg-white/25 disabled:opacity-60"
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
            className={`flex h-[38px] w-[38px] items-center justify-center rounded-[14px] text-base leading-none transition ${
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
