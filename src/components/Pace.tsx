import { ProgressRing } from './ProgressRing'
import { THEME } from '../lib/theme'
import type { GoalPace, PaceTone } from '../lib/goals'

// The pace signal, shared by the Goals cards and the goal detail hero so the two can never
// disagree. Two bars stacked: the solid one is you, the lighter one under it is where the
// calendar says you should be. That pairing is the whole idea — a single bar can't say
// whether 69% is good.

/** Days-left ring. The arc shows time SPENT, the number in the middle shows time LEFT. */
export function DaysRing({ pace, variant = 'card' }: { pace: GoalPace; variant?: 'card' | 'hero' }) {
  const hero = variant === 'hero'
  return (
    <ProgressRing
      percent={pace.elapsedFraction * 100}
      size={hero ? 76 : 44}
      strokeWidth={hero ? 6 : 4}
      // Neutral on a card: the accent is reserved for progress, and a second coloured ring
      // would read as a second measure of how well it's going.
      color={hero ? THEME.pineArc : '#b9b1a1'}
      trackColor={hero ? THEME.heroRingTrack : THEME.ringTrack}
    >
      <span className="flex flex-col items-center leading-none">
        <span className={hero ? 'text-[19px] font-semibold text-white' : 'text-[11px] font-semibold text-ink'}>
          {pace.daysLeft}
        </span>
        <span className={hero ? 'mt-1 text-[9px] font-medium text-white/75' : 'mt-0.5 text-[7px] font-medium text-ink-muted'}>
          {hero ? 'days left' : 'days'}
        </span>
      </span>
    </ProgressRing>
  )
}

/**
 * Progress over calendar pace. `pacePct` is the elapsed fraction, not a second measurement —
 * on a goal with no target both are meaningless, so the caller shouldn't render this at all.
 */
export function PaceBars({
  progressPct,
  pacePct,
  accent,
  variant = 'card',
}: {
  progressPct: number
  pacePct: number
  accent: string
  variant?: 'card' | 'hero'
}) {
  const hero = variant === 'hero'
  const track = hero ? 'rgba(255,255,255,.2)' : THEME.ringTrack
  const clamp = (n: number) => `${Math.min(100, Math.max(0, n))}%`
  return (
    <>
      <span className="block overflow-hidden rounded-full" style={{ height: hero ? 8 : 6, background: track }}>
        <span
          className="block h-full rounded-full"
          style={{ width: clamp(progressPct), background: hero ? '#fff' : accent }}
        />
      </span>
      <span className="block overflow-hidden rounded-full" style={{ height: hero ? 5 : 4, background: track }}>
        <span
          className="block h-full rounded-full"
          style={{
            width: clamp(pacePct),
            background: hero ? 'rgba(255,255,255,.45)' : accent,
            opacity: hero ? 1 : 0.38,
          }}
        />
      </span>
    </>
  )
}

const VERDICT_STYLE: Record<PaceTone, { background: string; color: string }> = {
  ahead: { background: '#e8efe8', color: '#1f6b5c' },
  behind: { background: '#f8eae4', color: '#a33327' },
  onPace: { background: '#efe9dc', color: '#58534a' },
}

export function VerdictChip({ label, tone }: { label: string; tone: PaceTone }) {
  return (
    <span className="rounded-full px-[9px] py-1 text-[10px] font-semibold" style={VERDICT_STYLE[tone]}>
      {label}
    </span>
  )
}

/** The legend that makes the double bar self-explanatory. Hero only, shown once. */
export function PaceLegend() {
  return (
    <span className="flex items-center gap-2.5 text-[10px] font-medium text-white/70">
      <span className="flex items-center gap-1">
        <span className="block h-[5px] w-3.5 rounded-full bg-white" />
        you
      </span>
      <span className="flex items-center gap-1">
        <span className="block h-1 w-3.5 rounded-full" style={{ background: 'rgba(255,255,255,.42)' }} />
        calendar pace
      </span>
    </span>
  )
}
