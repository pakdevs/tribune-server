// Phase 6: HTTP entity validation helpers (ETag + Last-Modified + conditional GET)

// Lightweight hash (FNV-1a 32-bit) for stable, fast ETag derivation
function fnv1a(str: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0
  }
  return ('0000000' + h.toString(16)).slice(-8)
}

export interface EntityMeta {
  etag: string
  lastModified: string
}

interface ArticleLike {
  id?: string
  publishDate?: string
  title?: string
}

// Strong mode includes hashed titles + timestamps for better change sensitivity.
// Configure via ETAG_MODE=strong (default: weak)
export function buildEntityMetadata(payload: { items?: ArticleLike[]; meta?: any }): EntityMeta {
  const mode = String(process.env.ETAG_MODE || 'weak').toLowerCase()
  const sort = String(process.env.ETAG_SORT || (mode === 'weak' ? '0' : '1')) === '1'
  const sampleStr = String(process.env.ETAG_ID_SAMPLE || '')
  const includeSummary = String(process.env.ETAG_STRONG_INCLUDE_SUMMARY || '0') === '1'
  const sample = (() => {
    if (!sampleStr) return 0
    const n = parseInt(sampleStr, 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  })()
  const rawItems = Array.isArray(payload.items) ? payload.items : []
  // Optional sort by publishDate desc then id for stable weak ETag independent of ordering noise
  const items = sort
    ? rawItems
        .slice()
        .sort(
          (a, b) =>
            (Date.parse(b.publishDate || '') || 0) - (Date.parse(a.publishDate || '') || 0) ||
            (a.id || '').localeCompare(b.id || '')
        )
    : rawItems
  let newest = 0
  if (mode === 'strong') {
    const parts: string[] = []
    const consider = sample ? items.slice(0, sample) : items
    for (const it of consider) {
      const id = it.id || ''
      let ts = 0
      if (it.publishDate) {
        const d = Date.parse(it.publishDate)
        if (!Number.isNaN(d)) ts = d
      }
      if (ts > newest) newest = ts
      const titleHash = fnv1a((it.title || '').slice(0, 160))
      let basisPart = `${id}:${ts}:${titleHash}`
      if (includeSummary && (it as any).summary) {
        const summaryHash = fnv1a(String((it as any).summary).slice(0, 200))
        basisPart += ':' + summaryHash
      }
      parts.push(basisPart)
    }
    const basis = `${items.length}|${newest}|${parts.join('|')}`
    const etag = '"' + fnv1a(basis) + '"'
    const lm = new Date(newest || Date.now()).toUTCString()
    return { etag, lastModified: lm }
  } else {
    const parts: string[] = []
    const consider = sample ? items.slice(0, sample) : items
    for (const it of consider) {
      const id = it.id || ''
      let ts = 0
      if (it.publishDate) {
        const d = Date.parse(it.publishDate)
        if (!Number.isNaN(d)) ts = d
      }
      if (ts > newest) newest = ts
      parts.push(id)
    }
    const basis = `${items.length}|${newest}|${parts.join(',')}`
    const etag = 'W/"' + fnv1a(basis) + '"'
    const lm = new Date(newest || Date.now()).toUTCString()
    return { etag, lastModified: lm }
  }
}

export function applyEntityHeaders(res: any, meta: EntityMeta) {
  res.setHeader('ETag', meta.etag)
  res.setHeader('Last-Modified', meta.lastModified)
  res.setHeader('Vary', 'Accept-Encoding')
}

// Evaluate conditional headers. Preference order: If-None-Match then If-Modified-Since.
export function isNotModified(req: any, meta: EntityMeta): boolean {
  try {
    const inm = req.headers['if-none-match']
    if (inm && typeof inm === 'string') {
      // Support multiple comma separated etags
      const tokens = inm.split(',').map((s) => s.trim())
      if (tokens.includes(meta.etag)) return true
    }
    const ims = req.headers['if-modified-since']
    if (ims && typeof ims === 'string') {
      const since = Date.parse(ims)
      const lm = Date.parse(meta.lastModified)
      if (!Number.isNaN(since) && !Number.isNaN(lm) && lm <= since) return true
    }
  } catch {}
  return false
}

// Utility to attach meta to payload (mutates) for reuse when cached
export function attachEntityMeta(payload: any) {
  if (!payload || payload.__etag) return payload
  try {
    const meta = buildEntityMetadata(payload)
    payload.__etag = meta.etag
    payload.__lm = meta.lastModified
  } catch {}
  return payload
}

export function extractEntityMeta(payload: any): EntityMeta | null {
  if (payload && payload.__etag && payload.__lm) {
    return { etag: payload.__etag, lastModified: payload.__lm }
  }
  try {
    if (payload && Array.isArray(payload.items)) return buildEntityMetadata(payload)
  } catch {}
  return null
}
