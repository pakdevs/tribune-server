import { cors, cache, upstreamJson } from '../_shared.js'
import { makeKey, getFresh, getStale, setCache } from '../_cache.js'
import { normalize } from '../_normalize.js'
import { getProvidersForPK, tryProvidersSequential } from '../_providers.js'

type Topic = { id: string; slug: string; label: string; score: number }

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'for',
  'and',
  'to',
  'in',
  'on',
  'at',
  'by',
  'with',
  'from',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'has',
  'have',
  'had',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'into',
  'after',
  'over',
  'under',
  'about',
  'pk',
  'pak',
  'pakistan',
  'pakistani',
  'breaking',
  'live',
  'update',
  'updates',
])

function slugify(s: string) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
}

function extractTokens(title: string, summary: string): string[] {
  const text = `${title || ''} ${summary || ''}`
  const raw = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const tokens: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i]
    const lower = w.toLowerCase()
    if (STOPWORDS.has(lower)) continue
    if (lower.length < 3) continue
    tokens.push(w)
    // Try simple bigram (for names like Imran Khan)
    if (i + 1 < raw.length) {
      const next = raw[i + 1]
      const bigram = `${w} ${next}`
      const bl = bigram.toLowerCase()
      if (!STOPWORDS.has(bl) && /[A-Z]/.test(w[0]) && /[A-Z]/.test(next[0])) {
        tokens.push(bigram)
      }
    }
  }
  return tokens
}

function scoreTopics(items: any[], now = Date.now()) {
  const counts = new Map<string, { c: number; w: number }>()
  const halfLifeHrs = 12
  const hlMs = halfLifeHrs * 3600 * 1000
  const decay = (t: number) => Math.exp(-(now - t) / hlMs)
  for (const it of items) {
    const t = Date.parse(it.publishDate || it.publishedAt || '') || now
    const w = decay(t)
    const toks = extractTokens(it.title || '', it.summary || '')
    for (const tk of toks) {
      const key = tk.trim()
      if (!key) continue
      const prev = counts.get(key) || { c: 0, w: 0 }
      prev.c += 1
      prev.w += w
      counts.set(key, prev)
    }
  }
  const arr: Topic[] = []
  for (const [label, v] of counts) {
    const sc = v.c + 1.2 * v.w
    const slug = slugify(label)
    if (!slug) continue
    arr.push({ id: slug, slug, label, score: sc })
  }
  // Prefer multi-word tokens, then score
  arr.sort((a, b) => {
    const aw = a.label.includes(' ') ? 1 : 0
    const bw = b.label.includes(' ') ? 1 : 0
    if (aw !== bw) return bw - aw
    return b.score - a.score
  })
  // De-duplicate near duplicates (case-insensitive exact slug match already unique)
  const seen = new Set<string>()
  const out: Topic[] = []
  for (const t of arr) {
    if (seen.has(t.slug)) continue
    seen.add(t.slug)
    out.push(t)
  }
  return out
}

export default async function handler(req: any, res: any) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  try {
    const region = String(req.query.region || 'pk').toLowerCase()
    const limit = Math.max(1, Math.min(20, parseInt(String(req.query.limit || '10'), 10) || 10))
    const noCache = String(req.query.nocache || '0') === '1'
    const key = makeKey(['trending', 'topics', region, limit])
    // Try KV first (if available), then in-memory cache
    try {
      if (!noCache) {
        const mod: any = await import('@vercel/kv').catch(() => null)
        const kv = mod?.kv
        if (kv) {
          const kvPayload = await kv.get(`topics:${region}:latest`)
          if (kvPayload) {
            res.setHeader('X-Cache', 'KV')
            cache(res, 300, 60)
            return res.status(200).json(kvPayload)
          }
        }
      }
    } catch {}
    const fresh = !noCache ? getFresh<any>(key) : null
    if (fresh) {
      res.setHeader('X-Cache', 'HIT')
      cache(res, 300, 60)
      return res.status(200).json(fresh)
    }

    res.setHeader('X-Cache', 'MISS')
    // Simple on-demand aggregation: pull PK-from and PK-mention sets, then score tokens
    const providers = region === 'pk' ? getProvidersForPK() : getProvidersForPK()
    const fetcher = (url: string, headers: Record<string, string>) => upstreamJson(url, headers)

    // 1) From PK: enforce country via q expression for Lite
    const fromRes = await tryProvidersSequential(
      providers,
      'top',
      {
        page: 1,
        pageSize: 10,
        country: 'pk',
        q: 'site.country:PK',
        pinQ: true,
      },
      fetcher
    )

    // 2) Mentions of Pakistan (about)
    const aboutRes = await tryProvidersSequential(
      providers,
      'top',
      {
        page: 1,
        pageSize: 10,
        country: undefined,
        q: 'Pakistan',
      },
      fetcher
    )

    const raws = [
      ...(Array.isArray(fromRes.items) ? fromRes.items : []),
      ...(Array.isArray(aboutRes.items) ? aboutRes.items : []),
    ]
    const normalized = raws.map((r: any) => normalize(r)).filter(Boolean)
    // Build topics
    const topics = scoreTopics(normalized).slice(0, limit)
    const payload = { region, asOf: new Date().toISOString(), topics }
    setCache(key, payload, 300, 3600)
    // Best-effort write to KV
    try {
      const mod: any = await import('@vercel/kv').catch(() => null)
      const kv = mod?.kv
      if (kv) {
        await kv.set(`topics:${region}:latest`, payload, { ex: 600 })
      }
    } catch {}
    cache(res, 300, 60)
    return res.status(200).json(payload)
  } catch (e: any) {
    const key = makeKey(['trending', 'topics', 'fallback'])
    const stale = getStale<any>(key)
    if (stale) {
      res.setHeader('X-Cache', 'STALE')
      return res.status(200).json(stale)
    }
    return res.status(500).json({ error: 'Failed to compute trending topics' })
  }
}
