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
        const s = titleSimilarity(t, String(existing.title || ''))
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
