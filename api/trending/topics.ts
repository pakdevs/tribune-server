import { cors, cache, upstreamJson, addCacheDebugHeaders } from '../../lib/_shared.js'
import { getFresh, getStale, setCache, setNegativeCache, getAny } from '../../lib/_cache.js'
import {
  applyEntityHeaders,
  extractEntityMeta,
  isNotModified,
  attachEntityMeta,
} from '../../lib/_http.js'
import { maybeScheduleRevalidate } from '../../lib/_revalidate.js'
import { buildCacheKey } from '../../lib/_key.js'
import { normalize } from '../../lib/_normalize.js'
import { getProvidersForPK, tryProvidersSequential } from '../../lib/_providers.js'

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

async function handler(req: any, res: any) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  try {
    const region = String(req.query.region || 'pk').toLowerCase()
    const limit = Math.max(1, Math.min(20, parseInt(String(req.query.limit || '10'), 10) || 10))
    const noCache = String(req.query.nocache || '0') === '1'
    const key = buildCacheKey('trending-topics', { region, limit })
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
    const any = !noCache ? getAny(key) : null
    if (any && any.negative) {
      res.setHeader('X-Cache', 'NEGATIVE')
      cache(res, 60, 60)
      await addCacheDebugHeaders(res, req)
      return res.status(200).json({ region, topics: [], negative: true })
    }
    const fresh = !noCache ? getFresh<any>(key) : null
    if (fresh) {
      res.setHeader('X-Cache', 'HIT')
      cache(res, 300, 60)
      await addCacheDebugHeaders(res, req)
      const meta = extractEntityMeta(fresh)
      if (meta) {
        if (isNotModified(req, meta)) {
          applyEntityHeaders(res, meta)
          return res.status(304).end()
        }
        applyEntityHeaders(res, meta)
      }
      maybeScheduleRevalidate(key, async () => {
        // Re-run logic for trending: fetch latest pk from/about pages and recompute topics
        const proto = String(req.headers['x-forwarded-proto'] || 'https')
        const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost')
        const base = `${proto}://${host}`
        const fromReqUrl = `${base}/api/pk?scope=from&page=1`
        const aboutReqUrl = `${base}/api/pk?scope=about&page=1`
        const headers = { 'user-agent': 'tribune/trending/1.0' }
        const [a, b] = await Promise.allSettled([
          upstreamJson(fromReqUrl, headers),
          upstreamJson(aboutReqUrl, headers),
        ])
        const fromRes = a.status === 'fulfilled' ? (a.value as any) : null
        const aboutRes = b.status === 'fulfilled' ? (b.value as any) : null
        const raws = [
          ...(Array.isArray(fromRes?.items) ? fromRes!.items : []),
          ...(Array.isArray(aboutRes?.items) ? aboutRes!.items : []),
        ]
        const normalized = raws.map((r: any) => normalize(r)).filter(Boolean)
        const topics = scoreTopics(normalized).slice(0, limit)
        return { items: topics, meta: { region, asOf: new Date().toISOString(), kind: 'topics' } }
      })
      return res.status(200).json(fresh)
    }

    res.setHeader('X-Cache', 'MISS')
    // Prefer using our own API (which benefits from CDN and stale cache) to reduce upstream calls.
    const proto = String(req.headers['x-forwarded-proto'] || 'https')
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost')
    const base = `${proto}://${host}`
    const fromReqUrl = `${base}/api/pk?scope=from&page=1`
    const aboutReqUrl = `${base}/api/pk?scope=about&page=1`
    const headers = { 'user-agent': 'tribune/trending/1.0' }
    const [a, b] = await Promise.allSettled([
      upstreamJson(fromReqUrl, headers),
      upstreamJson(aboutReqUrl, headers),
    ])
    const fromRes = a.status === 'fulfilled' ? (a.value as any) : null
    const aboutRes = b.status === 'fulfilled' ? (b.value as any) : null
    const raws = [
      ...(Array.isArray(fromRes?.items) ? fromRes!.items : []),
      ...(Array.isArray(aboutRes?.items) ? aboutRes!.items : []),
    ]
    if (raws.length === 0) {
      // If both failed, attempt to detect 429 and propagate appropriately so clients can retry.
      const errs: any[] = []
      if (a.status === 'rejected') errs.push(a.reason)
      if (b.status === 'rejected') errs.push(b.reason)
      const any429 = errs.some((e) => Number(e?.status) === 429)
      if (any429) {
        const ra = errs.find((e) => e?.retryAfter)?.retryAfter
        if (ra) res.setHeader('Retry-After', String(ra))
        return res
          .status(429)
          .json({ error: 'Rate limited', message: 'Downstream 429', retryAfter: ra || undefined })
      }
      throw new Error('No data available for trending')
    }
    const normalized = raws.map((r: any) => normalize(r)).filter(Boolean)
    // Build topics
    const topics = scoreTopics(normalized).slice(0, limit)
    const payload: any = { region, asOf: new Date().toISOString(), topics }
    attachEntityMeta(payload)
    setCache(key, payload, 300, 3600)
    maybeScheduleRevalidate(key, async () => {
      const proto = String(req.headers['x-forwarded-proto'] || 'https')
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost')
      const base = `${proto}://${host}`
      const fromReqUrl = `${base}/api/pk?scope=from&page=1`
      const aboutReqUrl = `${base}/api/pk?scope=about&page=1`
      const headers = { 'user-agent': 'tribune/trending/1.0' }
      const [a, b] = await Promise.allSettled([
        upstreamJson(fromReqUrl, headers),
        upstreamJson(aboutReqUrl, headers),
      ])
      const fromRes = a.status === 'fulfilled' ? (a.value as any) : null
      const aboutRes = b.status === 'fulfilled' ? (b.value as any) : null
      const raws = [
        ...(Array.isArray(fromRes?.items) ? fromRes!.items : []),
        ...(Array.isArray(aboutRes?.items) ? aboutRes!.items : []),
      ]
      const normalized = raws.map((r: any) => normalize(r)).filter(Boolean)
      const topics = scoreTopics(normalized).slice(0, limit)
      return { items: topics, meta: { region, asOf: new Date().toISOString(), kind: 'topics' } }
    })
    // Best-effort write to KV
    try {
      const mod: any = await import('@vercel/kv').catch(() => null)
      const kv = mod?.kv
      if (kv) {
        await kv.set(`topics:${region}:latest`, payload, { ex: 600 })
      }
    } catch {}
    cache(res, 300, 60)
    await addCacheDebugHeaders(res, req)
    const meta = extractEntityMeta(payload)
    if (meta) {
      if (isNotModified(req, meta)) {
        applyEntityHeaders(res, meta)
        return res.status(304).end()
      }
      applyEntityHeaders(res, meta)
    }
    return res.status(200).json(payload)
  } catch (e: any) {
    // On failure: prefer serving stale from KV or in-memory cache.
    try {
      const region = String(req.query.region || 'pk').toLowerCase()
      const limit = Math.max(1, Math.min(20, parseInt(String(req.query.limit || '10'), 10) || 10))
      const key = buildCacheKey('trending-topics', { region, limit })
      // Try KV stale first
      try {
        const mod: any = await import('@vercel/kv').catch(() => null)
        const kv = mod?.kv
        if (kv) {
          const kvPayload = await kv.get(`topics:${region}:latest`)
          if (kvPayload) {
            res.setHeader('X-Cache', 'KV-STALE')
            cache(res, 120, 60)
            return res.status(200).json(kvPayload)
          }
        }
      } catch {}
      // Then try in-memory stale
      const stale = getStale<any>(key)
      if (stale) {
        res.setHeader('X-Cache', 'STALE')
        cache(res, 120, 60)
        return res.status(200).json(stale)
      }
    } catch {}
    // If upstream signaled rate limit, propagate 429 with optional Retry-After
    const status = Number(
      e?.status ||
        e?.statusCode ||
        e?.response?.status ||
        e?.res?.status ||
        e?.cause?.response?.status ||
        (/\b(\d{3})\b/.exec(String(e?.message))?.[1] ?? '0')
    )
    if (status === 429) {
      const ra = e?.retryAfter
      if (ra) res.setHeader('Retry-After', String(ra))
      return res
        .status(429)
        .json({ error: 'Rate limited', message: 'Upstream 429', retryAfter: ra || undefined })
    }
    if (status !== 429) {
      try {
        const region = String(req.query.region || 'pk').toLowerCase()
        const limit = Math.max(1, Math.min(20, parseInt(String(req.query.limit || '10'), 10) || 10))
        const key = buildCacheKey('trending-topics', { region, limit })
        setNegativeCache(key)
      } catch {}
    }
    if (String(req.query.debug) === '1') {
      await addCacheDebugHeaders(res, req)
      return res
        .status(500)
        .json({ error: 'Failed to compute trending topics', message: String(e?.message || e) })
    }
    return res.status(500).json({ error: 'Failed to compute trending topics' })
  }
}

export default handler
