import { useEffect, useRef } from 'react'
import { useNav } from '../contexts/NavContext'
import { TopIcons } from './TopIcons'

// Every screen is the same three-part stack: a pine gradient hero that stays put, a
// scrolling off-white body, and the floating tab bar (owned by the shell). `hero` is
// whatever that screen puts under its title — summary chips, a date navigator, segmented
// period pills — rendered on the gradient rather than as another card below it.
export function Screen({
  title,
  subtitle,
  onBack,
  onRefresh,
  hero,
  children,
}: {
  title: string
  /** Small line under the title — only used by pushed views, which have no tab icons. */
  subtitle?: string
  /** When set the header becomes a pushed view: a back square instead of the tab icons. */
  onBack?: () => void
  onRefresh?: () => Promise<void>
  hero?: React.ReactNode
  children: React.ReactNode
}) {
  const { tab, setTab } = useNav()

  return (
    <div className="flex h-full flex-col">
      <header className="hero shrink-0">
        {onBack ? (
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              aria-label="Back"
              className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[14px] bg-white/16 text-base leading-none text-white"
            >
              ‹
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-[22px] font-semibold">{title}</h1>
              {subtitle && <p className="mt-0.5 text-xs font-medium text-white">{subtitle}</p>}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold">{title}</h1>
            <TopIcons active={tab} onChange={setTab} onRefresh={onRefresh} />
          </div>
        )}
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

// A search field that sits on the hero gradient rather than as the first card below it —
// keeps the list itself scrolled to the top of the body.
export function HeroSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className="mt-3.5 flex items-center gap-2.5 rounded-2xl bg-white/16 px-3.5 py-[11px]">
      <span className="shrink-0 text-sm">🔍</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-white placeholder-white/70 outline-none"
      />
      {value && (
        <button onClick={() => onChange('')} aria-label="Clear search" className="shrink-0 text-sm text-white/70">
          ✕
        </button>
      )}
    </div>
  )
}

// A horizontally scrolling row of filter/sort chips. `tone` picks where it lives: "body"
// chips sit on the page, "hero" chips on the gradient.
export function ChipRail<T extends string>({
  options,
  value,
  onChange,
  tone = 'body',
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
  tone?: 'body' | 'hero'
}) {
  return (
    <div className="no-scrollbar -mx-5 flex gap-[7px] overflow-x-auto px-5">
      {options.map((option) => {
        const active = option.id === value
        const className =
          tone === 'hero'
            ? active
              ? 'bg-surface text-pine-dark font-semibold'
              : 'bg-white/16 text-white font-medium'
            : active
              ? 'bg-pine text-white font-semibold'
              : 'bg-surface border border-line text-ink-2 font-medium'
        return (
          <button
            key={option.id}
            onClick={() => onChange(option.id)}
            className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 text-xs transition ${className}`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
