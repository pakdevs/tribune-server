import { normalize } from './_normalize.js'
import { cors, cache, upstreamJson, addCacheDebugHeaders } from './_shared.js'
import { withHttpMetrics } from './_httpMetrics.js'
import { getFresh, getStale, setCache, getFreshOrL2 } from './_cache.js'
import { maybeScheduleRevalidate } from './_revalidate.js'
import { buildCacheKey } from './_key.js'
import { getProvidersForWorld, tryProvidersSequential } from './_providers.js'
import { getInFlight, setInFlight } from './_inflight.js'

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

async function handler(req: any, res: any) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  // Minimal rate limiting: 60 req / 60s per IP
  try {
    const ip = String(
      req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || ''
    )
    const key = `rl:top:${ip}`
    const now = Date.now()
    ;(globalThis as any).__rl = (globalThis as any).__rl || new Map<string, number[]>()
    const rl: Map<string, number[]> = (globalThis as any).__rl
    const arr = (rl.get(key) || []).filter((t) => now - t < 60_000)
    if (arr.length >= 60) {
      res.setHeader('Retry-After', '30')
      return res.status(429).json({ error: 'Too Many Requests' })
    }
    arr.push(now)
    rl.set(key, arr)
  } catch {}
  const country = String(req.query.country || 'us')
  const rawPage = String(req.query.page || '1')
  const rawPageSize = String(req.query.pageSize || req.query.limit || '10')
  const pageNum = Math.max(1, parseInt(rawPage, 10) || 1)
  const pageSizeNum = Math.min(100, Math.max(1, parseInt(rawPageSize, 10) || 50))
  const rawCategory = req.query.category ? String(req.query.category).toLowerCase() : 'general'
  const mapped = rawCategory ? alias[rawCategory] || rawCategory : 'general'
  const category = allowed.has(mapped) ? mapped : 'general'
  try {
    const cacheKey = buildCacheKey('top', {
      country,
      category,
      page: pageNum,
      pageSize: pageSizeNum,
    })
    const noCache = String(req.query.nocache || '0') === '1'
    if (!noCache) {
      const fresh = getFresh(cacheKey) || (await getFreshOrL2(cacheKey))
      if (fresh) {
        res.setHeader('X-Cache', 'HIT')
        res.setHeader('X-Provider', fresh.meta.provider)
        res.setHeader('X-Provider-Attempts', fresh.meta.attempts.join(','))
        if (fresh.meta.attemptsDetail)
          res.setHeader('X-Provider-Attempts-Detail', fresh.meta.attemptsDetail.join(','))
        res.setHeader('X-Provider-Articles', String(fresh.items.length))
        if (!getFresh(cacheKey)) res.setHeader('X-Cache-L2', '1')
        cache(res, 300, 60)
        await addCacheDebugHeaders(res, req)
        maybeScheduleRevalidate(cacheKey, async () => {
          const providers = getProvidersForWorld()
          const result2 = await tryProvidersSequential(
            providers,
            'top',
            { page: pageNum, pageSize: pageSizeNum, country, category },
            (url, headers) => upstreamJson(url, headers)
          )
          const normalized2 = result2.items.map(normalize).filter(Boolean)
          return {
            items: normalized2,
            meta: {
              provider: result2.provider,
              attempts: result2.attempts || [result2.provider],
              attemptsDetail: result2.attemptsDetail,
            },
          }
        })
        return res.status(200).json({ items: fresh.items })
      }
    }
    res.setHeader('X-Cache', 'MISS')
    const providers = getProvidersForWorld()
    const flightKey = `top:${country}:${category}:${String(pageNum)}:${String(pageSizeNum)}`
    let flight = getInFlight(flightKey)
    if (!flight) {
      flight = setInFlight(
        flightKey,
        tryProvidersSequential(
          providers,
          'top',
          { page: pageNum, pageSize: pageSizeNum, country, category },
          (url, headers) => upstreamJson(url, headers)
        )
      )
    }
    const result = await flight
    const normalized = result.items.map(normalize).filter(Boolean)
    res.setHeader('X-Provider', result.provider)
    res.setHeader('X-Provider-Attempts', result.attempts?.join(',') || result.provider)
    if (result.attemptsDetail)
      res.setHeader('X-Provider-Attempts-Detail', result.attemptsDetail.join(','))
    setCache(cacheKey, {
      items: normalized,
      meta: {
        provider: result.provider,
        attempts: result.attempts || [result.provider],
        attemptsDetail: result.attemptsDetail,
      },
    })
    maybeScheduleRevalidate(cacheKey, async () => {
      const providers = getProvidersForWorld()
      const result2 = await tryProvidersSequential(
        providers,
        'top',
        { page: pageNum, pageSize: pageSizeNum, country, category },
        (url, headers) => upstreamJson(url, headers)
      )
      const normalized2 = result2.items.map(normalize).filter(Boolean)
      return {
        items: normalized2,
        meta: {
          provider: result2.provider,
          attempts: result2.attempts || [result2.provider],
          attemptsDetail: result2.attemptsDetail,
        },
      }
    })
    res.setHeader('X-Provider-Articles', String(normalized.length))
    cache(res, 300, 60)
    if (String(req.query.debug) === '1') {
      await addCacheDebugHeaders(res, req)
      return res.status(200).json({
        items: normalized,
        debug: {
          provider: result.provider,
          attempts: result.attempts,
          attemptsDetail: result.attemptsDetail,
          url: result.url,
          cacheKey,
          noCache,
          country,
          category,
        },
      })
    }
    await addCacheDebugHeaders(res, req)
    return res.status(200).json({ items: normalized })
  } catch (e: any) {
    const country = String(req.query.country || 'us')
    const rawPage = String(req.query.page || '1')
    const rawPageSize = String(req.query.pageSize || req.query.limit || '50')
    const pageNum = Math.max(1, parseInt(rawPage, 10) || 1)
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(rawPageSize, 10) || 50))
    const rawCategory = req.query.category ? String(req.query.category).toLowerCase() : 'general'
    const mapped = rawCategory ? alias[rawCategory] || rawCategory : 'general'
    const category = allowed.has(mapped) ? mapped : 'general'
    const cacheKey = buildCacheKey('top', {
      country,
      category,
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
    if (String(req.query.debug) === '1')
      return res.status(500).json({ error: 'Proxy failed', message: e?.message || String(e) })
    return res.status(500).json({ error: 'Proxy failed' })
  }
}

export default withHttpMetrics(handler)
