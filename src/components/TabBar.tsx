export type Tab = 'today' | 'calendar' | 'goals' | 'journal' | 'economy' | 'food' | 'training'

// Calendar and Settings are reachable from TopIcons instead of a bottom-bar slot — see there.
const TABS: { id: Tab; label: string; icon: string }[] = [
  // Colour emoji throughout; ️ forces emoji presentation where iOS would otherwise draw text.
  { id: 'today', label: 'Today', icon: '☀️' },
  { id: 'goals', label: 'Goals', icon: '🎯' },
  { id: 'journal', label: 'Journal', icon: '📝' },
  { id: 'economy', label: 'Economy', icon: '💰' },
  { id: 'food', label: 'Food', icon: '🥗' },
  { id: 'training', label: 'Training', icon: '🏋️' },
]

// A floating pine bar rather than a white one flush to the screen edge. All six tabs keep
// equal width — no centre FAB, which would displace one of them. Fixed over the content
// (which scrolls behind it, see --tabbar-space) and set down into the home-indicator zone.
export function TabBar({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="tabbar-pad pointer-events-none fixed inset-x-0 bottom-0 z-30">
      <div className="pointer-events-auto flex items-center gap-1 rounded-[22px] bg-pine-deep px-2 py-1.5 shadow-tabbar">
        {TABS.map((tab) => {
          const isActive = active === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`flex min-h-[50px] flex-1 flex-col items-center justify-center gap-[3px] rounded-[16px] text-[11px] text-white transition ${
                isActive ? 'bg-white/20 font-semibold' : 'font-medium'
              }`}
            >
              <span className="text-[18px] leading-none">{tab.icon}</span>
              {tab.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
