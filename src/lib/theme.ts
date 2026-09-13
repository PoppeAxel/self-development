// Raw values for the calm warm-neutral theme. Everything here is also a Tailwind token in
// `src/index.css` — use the utility classes (`bg-surface`, `text-ink`, …) in markup and
// reach for these only where a value is needed instead of a class: SVG strokes, recharts
// props, conic-gradient stops, inline widths.
export const THEME = {
  page: '#f3efe6',
  surface: '#fdfbf6',
  line: '#e9e2d4',
  lineStrong: '#ded5c3',
  track: '#efe9dc',
  ringTrack: '#ece5d7',
  ink: '#23241f',
  ink2: '#58534a',
  ink3: '#6e685c',
  inkMuted: '#8b8577',
  inkDisabled: '#a09a8c',
  inkFaint: '#c8c1b1',
  pine: '#2f6b5a',
  pineDark: '#26584a',
  pineDeep: '#27514a',
  pineDisc: '#26584f',
  pineArc: '#a8cfc0',
  chartGrid: '#eae3d5',
  // Progress arcs drawn on the pine hero read against a translucent white track.
  heroRingTrack: 'rgba(255,255,255,.2)',
} as const
