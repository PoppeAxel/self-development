import { useEffect, useRef } from 'react'
import { useNav } from '../contexts/NavContext'
import { TopIcons } from './TopIcons'

// Every screen is the same three-part stack: a pine gradient hero that stays put, a
// scrolling off-white body, and the floating tab bar (owned by the shell). `hero` is
// whatever that screen puts under its title — summary chips, a date navigator, segmented
// period pills — rendered on the gradient rather than as another card below it.
export function Screen({
  title,
  onRefresh,
  hero,
  children,
}: {
  title: string
  onRefresh?: () => Promise<void>
  hero?: React.ReactNode
  children: React.ReactNode
}) {
  const { tab, setTab } = useNav()

  return (
    <div className="flex h-full flex-col">
      <header className="hero shrink-0">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <TopIcons active={tab} onChange={setTab} onRefresh={onRefresh} />
        </div>
        {hero}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 px-5 pt-5 pb-2">{children}</div>
      </div>
    </div>
  )
}

// Segmented control on the hero: a translucent track with a solid off-white active pill.
// Used for Goals' periods, Journal's metrics and Food's sub-tabs.
export function HeroSegments<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}) {
  const activeRef = useRef<HTMLButtonElement>(null)

  // Once the labels stop fitting the track scrolls (see below), so the selected pill has
  // to bring itself into view — otherwise picking one off-screen leaves you looking at
  // someone else's pill.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [value])

  return (
    // `min-w-fit` on top of `flex-1 basis-0`: pills share the track evenly when there's
    // room, but never shrink below their own label — six would otherwise each get ~49px
    // and truncate "Strength". Past that the row scrolls sideways rather than squeezing.
    <div className="no-scrollbar mt-[18px] flex gap-1 overflow-x-auto rounded-[18px] bg-white/14 p-[5px]">
      {options.map((option) => (
        <button
          key={option.id}
          ref={value === option.id ? activeRef : undefined}
          onClick={() => onChange(option.id)}
          className={`min-w-fit flex-1 basis-0 whitespace-nowrap rounded-[14px] px-1.5 py-2 text-xs transition ${
            value === option.id ? 'bg-surface font-semibold text-pine-dark' : 'font-medium text-white'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

// A 999px glass pill for the hero's summary stats.
export function HeroChip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-white/16 px-[11px] py-[5px] text-xs font-medium text-white">{children}</span>
}
