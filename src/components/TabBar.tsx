export type Tab = 'today' | 'calendar' | 'goals' | 'journal' | 'food' | 'finance' | 'settings'

// Calendar and Settings are reachable from TopIcons instead of a bottom-bar slot — see there.
const TABS: { id: Tab; label: string; icon: string; active: string; iconBg: string }[] = [
  { id: 'today', label: 'Today', icon: '✓', active: 'text-pink-600', iconBg: 'bg-pink-100' },
  { id: 'goals', label: 'Goals', icon: '◎', active: 'text-amber-600', iconBg: 'bg-amber-100' },
  { id: 'journal', label: 'Journal', icon: '✎', active: 'text-violet-600', iconBg: 'bg-violet-100' },
  { id: 'food', label: 'Food', icon: '🍽', active: 'text-teal-600', iconBg: 'bg-teal-100' },
  { id: 'finance', label: 'Finance', icon: '💰', active: 'text-sky-600', iconBg: 'bg-sky-100' },
]

export function TabBar({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="safe-bottom px-4 pb-2">
      <div className="flex items-center justify-between rounded-3xl border border-gray-100 bg-white px-2 py-2 shadow-sm">
        {TABS.map((tab) => {
          const isActive = active === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`flex flex-1 flex-col items-center gap-1 rounded-2xl py-2 text-xs font-medium transition ${
                isActive ? tab.active : 'text-gray-400'
              }`}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-base leading-none ${
                  isActive ? tab.iconBg : ''
                }`}
              >
                {tab.icon}
              </span>
              {tab.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
