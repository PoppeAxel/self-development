export type Tab = 'today' | 'calendar' | 'goals' | 'journal' | 'food' | 'finance' | 'settings'

// Calendar and Settings are reachable from TopIcons instead of a bottom-bar slot — see there.
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: '✓' },
  { id: 'goals', label: 'Goals', icon: '◎' },
  { id: 'journal', label: 'Journal', icon: '✎' },
  { id: 'food', label: 'Food', icon: '🍽' },
  { id: 'finance', label: 'Finance', icon: '💰' },
]

// A floating pine bar rather than a white one flush to the screen edge. All five tabs keep
// equal width — no centre FAB, which would displace one of them.
export function TabBar({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="tabbar-pad">
      <div className="flex items-center gap-1 rounded-[24px] bg-pine-deep px-2.5 py-2 shadow-tabbar">
        {TABS.map((tab) => {
          const isActive = active === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-[18px] text-xs text-white transition ${
                isActive ? 'bg-white/20 font-semibold' : 'font-medium'
              }`}
            >
              <span className="text-[19px] leading-none">{tab.icon}</span>
              {tab.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
