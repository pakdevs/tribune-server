import { normalize } from './_normalize.js'
import { cors, cache, upstreamJson } from './_shared.js'
import { makeKey, getFresh, getStale, setCache } from './_cache.js'
import { getProvidersForWorld, tryProvidersSequential } from './_providers.js'
import { getUsedToday } from './_budget.js'
import { getInFlight, setInFlight } from './_inflight.js'

export default async function handler(req: any, res: any) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  // Minimal rate limiting: 60 req / 60s per IP
  try {
    const ip = String(
      req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || ''
    )
    const key = `rl:world:${ip}`
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
  const rawPage = String(req.query.page || '1')
  const pageNum = Math.max(1, parseInt(rawPage, 10) || 1)
  // Enforce fixed page size of 10 per request
  const pageSizeNum = 10
  let country = String(req.query.country || 'us').toLowerCase()
  if (!/^[a-z]{2}$/i.test(country)) country = 'us'
  const pageToken = req.query.pageToken ? String(req.query.pageToken) : undefined
  // Optional filters to pass to providers and enforce locally
  const domains = String(req.query.domains || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const sources = String(req.query.sources || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const q = String(req.query.q || '').trim()
  try {
    const cacheKey = makeKey([
      'world',
      'top',
      country,
      String(pageNum),
      String(pageSizeNum),
      pageToken ? 'pt:' + pageToken : '',
      'd:' + domains.join(','),
      's:' + sources.join(','),
    ])
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
        cache(res, 600, 120)
        return res.status(200).json({ items: fresh.items })
      }
    }
    // Miss path: attempt providers with in-flight dedupe
    res.setHeader('X-Cache', 'MISS')
    // Use Webz-only providers
    const providers = getProvidersForWorld()
    const flightKey = `world:${country}:${String(pageNum)}:${String(pageSizeNum)}:pt:${
      pageToken || ''
    }:d:${domains.join(',')}:s:${sources.join(',')}:q:${q}`
    let flight = getInFlight(flightKey)
    if (!flight) {
      flight = setInFlight(
        flightKey,
        tryProvidersSequential(
          providers,
          'top',
          { page: pageNum, pageSize: pageSizeNum, country, domains, sources, q, pageToken },
          (url, headers) => upstreamJson(url, headers)
        )
      )
    }
    const result = await flight
    let normalized = result.items.map(normalize).filter(Boolean)
    // Enforce domain allowlist if caller requested specific domains
    if (domains.length) {
      const allowed = new Set(
        domains.map((d) =>
          String(d)
            .toLowerCase()
            .replace(/^www\./, '')
        )
      )
      const before = normalized.length
      normalized = normalized.filter((n) => {
        const host = String(n.sourceDomain || '')
          .toLowerCase()
          .replace(/^www\./, '')
        return allowed.has(host)
      })
      res.setHeader('X-Filter-Domains-Applied', '1')
      res.setHeader('X-Articles-PreFilter', String(before))
      res.setHeader('X-Articles-PostFilter', String(normalized.length))
    }
    res.setHeader('X-Provider', result.provider)
    res.setHeader('X-Provider-Attempts', result.attempts?.join(',') || result.provider)
    if (result.attemptsDetail)
      res.setHeader('X-Provider-Attempts-Detail', result.attemptsDetail.join(','))
    if (Array.isArray((result as any).errors) && (result as any).errors.length) {
      res.setHeader('X-Provider-Errors', (result as any).errors.join(' | '))
    }
    if (domains.length) res.setHeader('X-World-Domains', domains.join(','))
    if (sources.length) res.setHeader('X-World-Sources', sources.join(','))
    res.setHeader('X-Provider-Articles', String(normalized.length))
    try {
      res.setHeader('X-Webz-Used-Today', String(getUsedToday('webz')))
    } catch {}
    setCache(cacheKey, {
      items: normalized,
      meta: {
        provider: result.provider,
        attempts: result.attempts || [result.provider],
        attemptsDetail: result.attemptsDetail,
      },
    })
    cache(res, 600, 120)
    if (String(req.query.debug) === '1') {
      return res.status(200).json({
        items: normalized,
        debug: {
          provider: result.provider,
          url: result.url,
          attempts: result.attempts,
          attemptsDetail: result.attemptsDetail,
          errors: (result as any).errors,
          cacheKey,
          noCache,
          country,
          domains,
          sources,
          q: q || null,
        },
      })
    }
    return res.status(200).json({ items: normalized })
  } catch (e: any) {
    const country = String(req.query.country || 'us')
    const rawPage = String(req.query.page || '1')
    const rawPageSize = '10'
    const pageNum = Math.max(1, parseInt(rawPage, 10) || 1)
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(rawPageSize, 10) || 50))
    const domains = String(req.query.domains || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const cacheKey = makeKey([
      'world',
      'top',
      country,
      String(pageNum),
      String(pageSizeNum),
      'd:' + domains.join(','),
    ])
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
    if (String(req.query.debug) === '1') {
      return res.status(500).json({
        error: 'Proxy failed',
        message: e?.message || String(e),
        hint: (e as any)?.hint,
      })
    }
    return res.status(500).json({ error: 'Proxy failed' })
  }
}
