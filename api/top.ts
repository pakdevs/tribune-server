import { normalize } from './_normalize.js'
import { cors, cache, upstreamJson } from './_shared.js'
import { makeKey, getFresh, getStale, setCache } from './_cache.js'
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

export default async function handler(req: any, res: any) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  const country = String(req.query.country || 'us')
  const page = String(req.query.page || '1')
  const pageSize = String(req.query.pageSize || req.query.limit || '50')
  const rawCategory = req.query.category ? String(req.query.category).toLowerCase() : 'general'
  const mapped = rawCategory ? alias[rawCategory] || rawCategory : 'general'
  const category = allowed.has(mapped) ? mapped : 'general'
  try {
    const cacheKey = makeKey(['top', country, category, page, pageSize])
    const noCache = String(req.query.nocache || '0') === '1'
    if (!noCache) {
      const fresh = getFresh(cacheKey)
      if (fresh) {
        res.setHeader('X-Cache', 'HIT')
        res.setHeader('X-Provider', fresh.meta.provider)
        res.setHeader('X-Provider-Attempts', fresh.meta.attempts.join(','))
        if (fresh.meta.attemptsDetail)
          res.setHeader('X-Provider-Attempts-Detail', fresh.meta.attemptsDetail.join(','))
        res.setHeader('X-Provider-Articles', String(fresh.items.length))
        cache(res, 300, 60)
        return res.status(200).json({ items: fresh.items })
      }
    }
    res.setHeader('X-Cache', 'MISS')
    const providers = getProvidersForWorld()
    const flightKey = `top:${country}:${category}:${page}:${pageSize}`
    let flight = getInFlight(flightKey)
    if (!flight) {
      flight = setInFlight(
        flightKey,
        tryProvidersSequential(
          providers,
          'top',
          { page, pageSize, country, category },
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
    res.setHeader('X-Provider-Articles', String(normalized.length))
    cache(res, 300, 60)
    if (String(req.query.debug) === '1') {
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
    return res.status(200).json({ items: normalized })
  } catch (e: any) {
    const country = String(req.query.country || 'us')
    const page = String(req.query.page || '1')
    const pageSize = String(req.query.pageSize || req.query.limit || '50')
    const rawCategory = req.query.category ? String(req.query.category).toLowerCase() : 'general'
    const mapped = rawCategory ? alias[rawCategory] || rawCategory : 'general'
    const category = allowed.has(mapped) ? mapped : 'general'
    const cacheKey = makeKey(['top', country, category, page, pageSize])
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
