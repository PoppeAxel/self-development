export type Tab = 'today' | 'goals' | 'journal' | 'settings'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: '✓' },
  { id: 'goals', label: 'Goals', icon: '◎' },
  { id: 'journal', label: 'Journal', icon: '✎' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

export function TabBar({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="safe-bottom flex border-t border-slate-800 bg-slate-900">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs ${
            active === tab.id ? 'text-indigo-400' : 'text-slate-500'
          }`}
        >
          <span className="text-lg leading-none">{tab.icon}</span>
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
