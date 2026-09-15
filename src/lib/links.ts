// Saved recipe links (the Food tab's Links sub-tab). The only real logic here is deciding
// when two pasted URLs are the same page — everything else is presentation.

/** Params that identify a campaign, a referrer or a session, never the page itself. */
const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'ref',
  'ref_src',
  'source',
  'si',
]

/** host must look like a real domain — keeps "chicken curry" from being saved as a link. */
const HOSTNAME_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i
/** Anything already carrying a scheme is parsed as-is; a bare "ica.se/..." gets https://. */
const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

export interface NormalizedLink {
  /** The usable URL — original scheme and host (a www-only site still has to resolve),
      minus the tracking params and the fragment. This is what gets opened and imported. */
  url: string
  /** The dedup key. Never shown, never fetched. */
  key: string
}

/**
 * Returns null for anything that isn't an http(s) URL, so a typo can't be saved as a link.
 *
 * The key deliberately ignores what doesn't change which page you land on: scheme
 * (http/https), a leading `www.`, a trailing slash, the `#fragment`, tracking params, and
 * the order of the params that are left. Path case IS kept — paths are case-sensitive on
 * plenty of servers, and wrongly merging two pages is worse than keeping two rows.
 */
export function normalizeUrl(raw: string): NormalizedLink | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  let parsed: URL
  try {
    parsed = new URL(HAS_SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!HOSTNAME_RE.test(parsed.hostname)) return null

  parsed.hash = ''
  for (const param of TRACKING_PARAMS) parsed.searchParams.delete(param)

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  const path = parsed.pathname.replace(/\/+$/, '')
  const params = [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b))
  const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : ''

  return { url: parsed.toString(), key: `${host}${path}${query}` }
}

/** "https://www.ica.se/recept/…" → "ica.se" — the caption on a saved-link row. */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * A readable name from the URL itself, for a link saved without one:
 * "…/recept/kycklinggryta-med-curry-723456/" → "Kycklinggryta med curry".
 * Returns '' when the path carries nothing usable (a bare domain, an all-numeric slug) —
 * the caller falls back to the host rather than showing a blank row.
 */
export function titleFromUrl(url: string): string {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return ''
  }

  const segments = path.split('/').filter(Boolean)
  const last = segments.pop()
  if (!last) return ''

  let slug = last.replace(/\.(html?|php|aspx?)$/i, '')
  try {
    slug = decodeURIComponent(slug)
  } catch {
    /* a malformed escape isn't worth failing over — use the raw slug */
  }

  const words = slug
    .split(/[-_+]+/)
    .filter((w) => w && !/^\d+$/.test(w)) // recipe ids ride along on the end of most slugs
  if (words.length === 0) return ''

  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * What to call a saved link. `title` is only ever a real name — one typed by hand, or the
 * recipe's own name once the link has been imported — so a link that has never been named
 * falls back to its slug, and finally to the bare host for a URL with nothing in the path.
 */
export function linkLabel(link: { url: string; title: string | null }): string {
  return link.title || titleFromUrl(link.url) || linkHost(link.url)
}
