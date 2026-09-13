import { THEME } from '../lib/theme'

interface ProgressRingProps {
  percent: number
  size?: number
  strokeWidth?: number
  color?: string
  trackColor?: string
  /** Fills the ring's centre with a solid disc behind `children` (off-white on cards, pine on the hero). */
  disc?: string
  children?: React.ReactNode
}

export function ProgressRing({
  percent,
  size = 72,
  strokeWidth = 8,
  color = THEME.pine,
  trackColor = THEME.ringTrack,
  disc,
  children,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference
  const discSize = size - strokeWidth * 2

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.3s ease' }}
        />
      </svg>
      {disc && (
        <div
          className="absolute rounded-full"
          style={{ width: discSize, height: discSize, background: disc, top: strokeWidth, left: strokeWidth }}
        />
      )}
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  )
}
