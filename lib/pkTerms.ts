// Centralized Pakistan keyword terms used for about-scope detection and search expansion.
// Keep terms lowercase; multi-word phrases allowed.
export const PK_TERMS: string[] = [
  // Core country / demonym
  'pakistan',
  'pakistani',
  // Major cities
  'islamabad',
  'lahore',
  'karachi',
  'peshawar',
  'rawalpindi',
  'faisalabad',
  'multan',
  'quetta',
  'hyderabad',
  'gwadar',
  // Provinces / regions
  'balochistan',
  'sindh',
  'punjab',
  'kpk',
  'gilgit-baltistan',
  'azad kashmir',
  // Economy & finance
  'pak rupee',
  'rupee',
  'state bank',
  'sbp',
  'kse-100',
  'psx',
  'imf',
  'cpec',
  // Politics / leadership (avoid over‑broad generic words)
  'imran khan',
  'shehbaz sharif',
  'bilawal bhutto',
  'asif zardari',
  // Security / events
  'terror',
  'militant',
  'election',
  'elections',
  // Government shorthand
  'pak govt',
]

export const PK_BUSINESS_CONCEPT_URIS: string[] = [
  'http://en.wikipedia.org/wiki/Business',
  'http://en.wikipedia.org/wiki/Economy',
  'http://en.wikipedia.org/wiki/Finance',
  'http://en.wikipedia.org/wiki/Trade',
]

// Build an OR expression suitable for NewsAPI.ai article search payloads.
// Examples:
//   (pakistan OR pakistani OR islamabad)
//   (pakistan OR "imran khan" OR "state bank" OR islamabad)
// Limit number of terms to avoid excessively large payloads (and to keep legacy URL fallbacks under control).
// Simple memo cache so repeated builds (hot path) do not re-stringify.
// Keyed by maxTerms + a lightweight fingerprint of the current PK_TERMS contents.
const __pkQueryMemo = new Map<string, string>()

export function buildPakistanOrQuery(maxTerms = 10, maxEncodedLength = 1700) {
  const terms = PK_TERMS.slice(0, Math.max(1, maxTerms))
  if (!terms.length) return 'Pakistan'
  const fp = `${terms.length}:${terms[0]}:${terms[terms.length - 1]}`
  const memoKey = `${maxTerms}:${fp}:${maxEncodedLength}`
  if (__pkQueryMemo.has(memoKey)) return __pkQueryMemo.get(memoKey) as string
  let active = terms.slice()
  // Build, then shrink until encoded length is under safety threshold
  function render(parts: string[]) {
    if (!parts.length) return 'Pakistan'
    if (parts.length === 1) return parts[0]
    return '(' + parts.map((t) => (t.includes(' ') ? '"' + t + '"' : t)).join(' OR ') + ')'
  }
  let expr = render(active)
  // URL encoded length guard. We only consider the query fragment; full URL adds ~100 chars buffer.
  while (encodeURIComponent(expr).length > maxEncodedLength && active.length > 1) {
    active.pop()
    expr = render(active)
  }
  __pkQueryMemo.set(memoKey, expr)
  return expr
}

// Helper for tests to clear memo (not exported publicly in type sense but accessible via bracket).
;(buildPakistanOrQuery as any).clearMemo = () => __pkQueryMemo.clear()
