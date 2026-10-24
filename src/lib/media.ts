// Journal → Media: books, games, movies, series — whatever kinds are in `options` (kind
// 'media_kind', migration 0049, edited in place in the Media tab) — finished, rated 1–5 with an
// optional short review (media_entries). Pure — no supabase import.
import { findOption, live } from './optionStore'
import type { OptionRow } from './editable'

/** A media_kind key. */
export type MediaKind = string

export interface MediaKindInfo {
  key: MediaKind
  label: string
  plural: string
  icon: string
}

const toKind = (r: OptionRow): MediaKindInfo => ({ key: r.key, label: r.label, plural: String(r.meta.plural || r.label), icon: r.icon ?? '🏷' })

/** Live kinds, in order. */
export const mediaKinds = (): MediaKindInfo[] => live('media_kind').map(toKind)

/** Any kind by key (archived too, so old entries keep their icon); an unknown key reads as itself. */
export const mediaInfo = (key: MediaKind): MediaKindInfo => {
  const r = findOption('media_kind', key)
  return r ? toKind(r) : { key, label: key, plural: key, icon: '🏷' }
}

export interface MediaEntry {
  id: string
  user_id: string
  title: string
  kind: MediaKind
  rating: number | null
  review: string | null
  finished_on: string
}

// Goal sources: a goal like "Read 12 books" counts finished entries of one kind in its period.
// The first four kinds were stored under these names before kinds were editable, so goals keep
// them; any other kind's source is 'media:<key>'.
const LEGACY_METRIC: Record<string, MediaKind> = {
  books_finished: 'book',
  games_finished: 'game',
  movies_finished: 'movie',
  series_finished: 'series',
}
export type MediaMetric = 'books_finished' | 'games_finished' | 'movies_finished' | 'series_finished' | `media:${string}`

/** One goal source per live kind. */
export const mediaMetrics = (): MediaMetric[] =>
  mediaKinds().map((k): MediaMetric => (Object.keys(LEGACY_METRIC).find((m) => LEGACY_METRIC[m] === k.key) as MediaMetric | undefined) ?? `media:${k.key}`)

export function isMediaMetric(value: string | null): value is MediaMetric {
  return value != null && (value in LEGACY_METRIC || value.startsWith('media:'))
}

/** The media kind a media goal source counts. */
export const mediaKindOf = (metric: MediaMetric): MediaKind => LEGACY_METRIC[metric] ?? metric.slice('media:'.length)

/** The goal source for one kind (what mediaMetrics() lists for it). */
export const mediaMetricOf = (kind: MediaKind): MediaMetric => mediaMetrics().find((m) => mediaKindOf(m) === kind) ?? `media:${kind}`
