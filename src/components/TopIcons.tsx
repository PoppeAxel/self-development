import type { Tab } from './TabBar'

const ICONS: { id: Tab; icon: string; label: string; active: string }[] = [
  { id: 'calendar', icon: '📅', label: 'Calendar', active: 'bg-rose-100 text-rose-600' },
  { id: 'settings', icon: '⚙', label: 'Settings', active: 'bg-emerald-100 text-emerald-600' },
]

// Calendar and Settings don't get their own slot in the bottom TabBar since they're used
// far less than the other tabs — instead they're reachable from this small icon row at
// the top of every page. Getting back to them from elsewhere in the app still just means
// tapping any bottom tab, same as before.
export function TopIcons({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <div className="flex items-center justify-end gap-2 px-4 pt-3">
      {ICONS.map((item) => {
        const isActive = active === item.id
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            aria-label={item.label}
            className={`flex h-9 w-9 items-center justify-center rounded-full text-base leading-none transition ${
              isActive ? item.active : 'text-gray-400'
            }`}
          >
            {item.icon}
          </button>
        )
      })}
    </div>
  )
}
