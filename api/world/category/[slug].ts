import { normalize } from '../../../lib/_normalize.js'
import { cors, cache, upstreamJson, addCacheDebugHeaders } from '../../../lib/_shared.js'
import { withHttpMetrics } from '../../../lib/_httpMetrics.js'
import {
  getFresh,
  getStale,
  setCache,
  setNegativeCache,
  getAny,
  getFreshOrL2,
} from '../../../lib/_cache.js'
import {
  applyEntityHeaders,
  extractEntityMeta,
  isNotModified,
  attachEntityMeta,
} from '../../../lib/_http.js'
import { buildCacheKey } from '../../../lib/_key.js'
import { getProvidersForWorld, tryProvidersSequential } from '../../../lib/_providers.js'

async function handler(req: any, res: any) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  const rawSlug = String(req.query.slug || '').toLowerCase()
  const alias: Record<string, string> = {
    politics: 'general',
    world: 'general',
    tech: 'technology',
    sci: 'science',
    biz: 'business',
  }
  const allowed = new Set([
    'business',
    'entertainment',
    'general',
    'health',
    'science',
    'sports',
    'technology',
  ])
  const mapped = rawSlug ? alias[rawSlug] || rawSlug : 'general'
  const category = allowed.has(mapped) ? mapped : 'general'

  const rawPage = String(req.query.page || '1')
  const rawPageSize = String(req.query.pageSize || req.query.limit || '20')
  const pageNum = Math.max(1, parseInt(rawPage, 10) || 1)
  const pageSizeNum = Math.min(100, Math.max(1, parseInt(rawPageSize, 10) || 50))
  const country = String(req.query.country || 'us')
  // Optional filters: domains, sources
  const domains = String(req.query.domains || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const sources = String(req.query.sources || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  try {
    const cacheKey = buildCacheKey('world-cat', {
      category,
      country,
      page: pageNum,
      pageSize: pageSizeNum,
      domains,
      sources,
    })
    const noCache = String(req.query.nocache || '0') === '1'
    if (!noCache) {
      const any = getAny(cacheKey)
      if (any && any.negative) {
        res.setHeader('X-Cache', 'NEGATIVE')
        cache(res, 30, 30)
        await addCacheDebugHeaders(res, req)
        return res.status(200).json({ items: [], negative: true })
      }
      const fresh = getFresh(cacheKey) || (await getFreshOrL2(cacheKey))
      if (fresh) {
        res.setHeader('X-Cache', 'HIT')
        res.setHeader('X-Provider', fresh.meta.provider)
        res.setHeader('X-Provider-Attempts', fresh.meta.attempts.join(','))
        if (fresh.meta.attemptsDetail)
          res.setHeader('X-Provider-Attempts-Detail', fresh.meta.attemptsDetail.join(','))
        res.setHeader('X-Provider-Articles', String(fresh.items.length))
        if (!getFresh(cacheKey)) res.setHeader('X-Cache-L2', '1')
        cache(res, 600, 120)
        await addCacheDebugHeaders(res, req)
        const meta = extractEntityMeta(fresh)
        if (meta) {
          if (isNotModified(req, meta)) {
            applyEntityHeaders(res, meta)
            return res.status(304).end()
          }
          applyEntityHeaders(res, meta)
        }
        return res.status(200).json({ items: fresh.items })
      }
    }
    res.setHeader('X-Cache', 'MISS')
    // Use GNews-only providers
    const providers = getProvidersForWorld()
    const result = await tryProvidersSequential(
      providers,
      'top',
      { page: pageNum, pageSize: pageSizeNum, country, category, domains, sources },
      (url, headers) => upstreamJson(url, headers)
    )
    const normalized = result.items.map(normalize).filter(Boolean)
    res.setHeader('X-Provider', result.provider)
    res.setHeader('X-Provider-Attempts', result.attempts?.join(',') || result.provider)
    if (result.attemptsDetail)
      res.setHeader('X-Provider-Attempts-Detail', result.attemptsDetail.join(','))
    if (domains.length) res.setHeader('X-World-Domains', domains.join(','))
    if (sources.length) res.setHeader('X-World-Sources', sources.join(','))
    res.setHeader('X-Provider-Articles', String(normalized.length))
    const cachePayload: any = {
      items: normalized,
      meta: {
        provider: result.provider,
        attempts: result.attempts || [result.provider],
        attemptsDetail: result.attemptsDetail,
      },
    }
    attachEntityMeta(cachePayload)
    setCache(cacheKey, cachePayload)
    cache(res, 600, 120)
    const entityMeta = extractEntityMeta(cachePayload)
    if (String(req.query.debug) === '1') {
      await addCacheDebugHeaders(res, req)
      if (entityMeta) {
        if (isNotModified(req, entityMeta)) {
          applyEntityHeaders(res, entityMeta)
          return res.status(304).end()
        }
        applyEntityHeaders(res, entityMeta)
      }
      return res.status(200).json({
        items: normalized,
        debug: {
          provider: result.provider,
          url: result.url,
          attempts: result.attempts,
          attemptsDetail: result.attemptsDetail,
          cacheKey,
          noCache,
          category,
        },
      })
    }
    await addCacheDebugHeaders(res, req)
    if (entityMeta) {
      if (isNotModified(req, entityMeta)) {
        applyEntityHeaders(res, entityMeta)
        return res.status(304).end()
      }
      applyEntityHeaders(res, entityMeta)
    }
    return res.status(200).json({ items: normalized })
  } catch (e: any) {
    const cacheKey = buildCacheKey('world-cat', {
      category,
      country,
      page: pageNum,
      pageSize: pageSizeNum,
    })
    const stale = getStale(cacheKey)
    if (stale) {
      res.setHeader('X-Cache', 'STALE')
      res.setHeader('X-Stale', '1')
      res.setHeader('X-Provider', stale.meta.provider)
      res.setHeader('X-Provider-Attempts', stale.meta.attempts.join(','))
      if (stale.meta.attemptsDetail)
        res.setHeader('X-Provider-Attempts-Detail', stale.meta.attemptsDetail.join(','))
      res.setHeader('X-Provider-Articles', String(stale.items.length))
      return res.status(200).json({ items: stale.items, stale: true })
    }
    // Negative caching (exclude 429)
    const status = Number(e?.status || (/\b(\d{3})\b/.exec(String(e?.message))?.[1] ?? '0'))
    if (status !== 429) setNegativeCache(cacheKey)
    if (String(req.query.debug) === '1') {
      await addCacheDebugHeaders(res, req)
      return res.status(500).json({ error: 'Proxy failed', message: e?.message || String(e) })
    }
    return res.status(500).json({ error: 'Proxy failed' })
  }
}

export default withHttpMetrics(handler)
