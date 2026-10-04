// Journal → Media: books, games, movies and series finished, rated 1–5 with an optional
// short review (media_entries). Pure — no supabase import.

export const MEDIA_KINDS = ['book', 'game', 'movie', 'series'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

export const MEDIA_INFO: Record<MediaKind, { label: string; plural: string; icon: string }> = {
  book: { label: 'Book', plural: 'Books', icon: '📚' },
  game: { label: 'Game', plural: 'Games', icon: '🎮' },
  movie: { label: 'Movie', plural: 'Movies', icon: '🎬' },
  series: { label: 'Series', plural: 'Series', icon: '📺' },
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
export const MEDIA_METRICS = ['books_finished', 'games_finished', 'movies_finished', 'series_finished'] as const
export type MediaMetric = (typeof MEDIA_METRICS)[number]
export const MEDIA_METRIC_KIND: Record<MediaMetric, MediaKind> = {
  books_finished: 'book',
  games_finished: 'game',
  movies_finished: 'movie',
  series_finished: 'series',
}
export function isMediaMetric(value: string | null): value is MediaMetric {
  return value != null && (MEDIA_METRICS as readonly string[]).includes(value)
}
