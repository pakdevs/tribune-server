export type Item = { title?: string; url?: string; link?: string; sourceUrl?: string; id?: string }

function keyOf(it: Item) {
  return String(it.url || it.link || it.sourceUrl || it.id || '').toLowerCase()
}

function tokenizeTitle(t = ''): string[] {
  return String(t || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && w.length > 2)
}

export function titleSimilarity(a: string, b: string): number {
  const A = new Set(tokenizeTitle(a))
  const B = new Set(tokenizeTitle(b))
  if (A.size === 0 && B.size === 0) return 1
  const union = new Set([...A, ...B])
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return union.size ? inter / union.size : 0
}

export function dedupeByTitle<T extends Item>(items: T[], threshold = 0.9): T[] {
  const seen = new Set<string>()
  const kept: T[] = []
  for (const it of items) {
    const k = keyOf(it)
    if (k && seen.has(k)) continue
    // check title similarity against kept
    const t = String(it.title || '')
    let dup = false
    if (t) {
      for (const existing of kept) {
        const s = titleSimilarity(t, String((existing as any).title || ''))
        if (s >= threshold) {
          dup = true
          break
        }
      }
    }
    if (dup) continue
    if (k) seen.add(k)
    kept.push(it)
  }
  return kept
}

// Canonicalize URLs to collapse slug variants with numeric IDs and strip noise
export function canonicalizeUrl(raw?: string): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  try {
    const u = new URL(s)
    const host = u.hostname.replace(/^www\./i, '').toLowerCase()
    let path = u.pathname || '/'
    // Collapse numeric-id + slug paths: e.g., /news/1234/slug -> /news/1234
    path = path.replace(/(\/news\/)\d+(?:\/.*)?$/i, (m) => {
      const m2 = /(\/news\/)(\d+)/i.exec(m)
      return m2 ? `${m2[1]}${m2[2]}` : m
    })
    // Remove trailing slash (except root)
    if (path.length > 1) path = path.replace(/\/+$/g, '')
    return `${host}${path}`
  } catch {
    // Fallback: lowercase, drop query/hash heuristically
    const noHash = s.split('#')[0]
    const noQuery = noHash.split('?')[0]
    return noQuery.toLowerCase()
  }
}

// Dedupe items keeping the first occurrence (assumed best-ranked) by canonical URL, fallback id
export function dedupeByCanonicalUrl<T extends Item>(items: T[]): T[] {
  const seen = new Set<string>()
  const kept: T[] = []
  for (const it of items) {
    const url = String(it.url || it.link || it.sourceUrl || '')
    const key = canonicalizeUrl(url) || String(it.id || '').toLowerCase()
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    kept.push(it)
  }
  return kept
}
