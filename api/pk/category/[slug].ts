import { normalize } from '../../_normalize.js'
import { cors, cache, upstreamJson } from '../../_shared.js'
import { makeKey, getFresh, getStale, setCache } from '../../_cache.js'
import { getProvidersForPK, tryProvidersSequential } from '../../_providers.js'
import { PK_DOMAINS } from '../_domains.js'

export default async function handler(req: any, res: any) {
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

  const page = String(req.query.page || '1')
  const pageSize = String(req.query.pageSize || req.query.limit || '50')
  // Domain scoping controls
  const domainsParam = String(req.query.domains || '').trim()
  const mode = String(req.query.mode || 'extend').toLowerCase()
  const userDomains = domainsParam
    ? domainsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
  const useDomains =
    mode === 'replace' && userDomains.length
      ? Array.from(new Set(userDomains))
      : Array.from(new Set([...PK_DOMAINS, ...userDomains]))
  const country = 'pk'
  try {
    const cacheKey = makeKey([
      'pk',
      'cat',
      category,
      'pk',
      page,
      pageSize,
      'd:' + useDomains.join(','),
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
        cache(res, 300, 60)
        return res.status(200).json({ items: fresh.items })
      }
    }
    res.setHeader('X-Cache', 'MISS')
    const providers = getProvidersForPK()
    let result = await tryProvidersSequential(
      providers,
      'top',
      { page, pageSize, country, category, domains: useDomains, q: category },
      (url, headers) => upstreamJson(url, headers)
    )
    let normalized = result.items.map(normalize).filter(Boolean)
    let pkFallback: string | undefined
    // Fallback 1: if empty, try with domains + q="Pakistan <category>"
    if (!normalized.length) {
      try {
        const fb1 = await tryProvidersSequential(
          providers,
          'top',
          {
            page,
            pageSize,
            country,
            domains: useDomains,
            q: category && category !== 'general' ? `Pakistan ${category}` : 'Pakistan',
          },
          (url, headers) => upstreamJson(url, headers)
        )
        const n1 = fb1.items.map(normalize).filter(Boolean)
        if (n1.length) {
          result = fb1
          normalized = n1
          pkFallback = 'domains+q'
        }
      } catch {}
    }
    // Fallback 2: if still empty, try q=Pakistan with no domains
    if (!normalized.length) {
      try {
        const fb2 = await tryProvidersSequential(
          providers,
          'top',
          { page, pageSize, country, q: 'Pakistan' },
          (url, headers) => upstreamJson(url, headers)
        )
        const n2 = fb2.items.map(normalize).filter(Boolean)
        if (n2.length) {
          result = fb2
          normalized = n2
          pkFallback = 'q-only'
        }
      } catch {}
    }
    res.setHeader('X-Provider', result.provider)
    res.setHeader('X-Provider-Attempts', result.attempts?.join(',') || result.provider)
    if (result.attemptsDetail)
      res.setHeader('X-Provider-Attempts-Detail', result.attemptsDetail.join(','))
    res.setHeader('X-PK-Domains', useDomains.join(','))
    if (pkFallback) res.setHeader('X-PK-Fallback', pkFallback)
    res.setHeader('X-Provider-Articles', String(normalized.length))
    setCache(cacheKey, {
      items: normalized,
      meta: {
        provider: result.provider,
        attempts: result.attempts || [result.provider],
        attemptsDetail: result.attemptsDetail,
      },
    })
    cache(res, 300, 60)
    if (String(req.query.debug) === '1') {
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
          domains: useDomains,
          fallback: pkFallback || null,
        },
      })
    }
    return res.status(200).json({ items: normalized })
  } catch (e: any) {
    const cacheKey = makeKey(['pk', 'cat', category, 'pk', page, pageSize])
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
