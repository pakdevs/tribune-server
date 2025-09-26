// Centralized Pakistan keyword terms used for about-scope detection and search expansion.
// Keep terms lowercase; multi-word phrases allowed.
export const PK_TERMS: string[] = [
  'pakistan',
  'pakistani',
  'islamabad',
  'lahore',
  'karachi',
  'peshawar',
  'rawalpindi',
  'balochistan',
  'sindh',
  'punjab',
  'kpk',
  'gilgit-baltistan',
  'azad kashmir',
  'pak rupee',
  'pak govt',
]

// Build an OR expression suitable for GNews search.
// Limit number of terms to avoid excessively long URLs (GNews + typical 2KB URL limit safety).
export function buildPakistanOrQuery(maxTerms = 10) {
  const slice = PK_TERMS.slice(0, maxTerms)
  if (!slice.length) return 'Pakistan'
  if (slice.length === 1) return slice[0]
  return '(' + slice.map((t) => (t.includes(' ') ? '"' + t + '"' : t)).join(' OR ') + ')'
}
