import { normalize } from '../../../lib/_normalize.js'
import { getPkAllowlistMeta, isHostInAllowlist } from '../../../lib/pkAllowlist.js'
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
import { buildCacheKey } from '../../../lib/_key.js'
import {
  getProvidersForPKTop as getProvidersForPK,
  tryProvidersSequential,
} from '../../../lib/_providers.js'

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

  const page = String(req.query.page || '1')
  const pageSize = String(req.query.pageSize || req.query.limit || '10')
  // Scoping: union (default), from, about
  const scope = String(req.query.scope || 'union')
  // Optional filters: domains, sources
  const domains = String(req.query.domains || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const sources = String(req.query.sources || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const country = 'pk'
  // Load PK allowlist once per request (seed-only in this build)
  let allowlist: string[] = []
  let allowlistSource = 'seed'
  try {
    const meta = await getPkAllowlistMeta()
    allowlist = meta.list
    allowlistSource = meta.source || 'seed'
  } catch {}
  try {
    const cacheKey = buildCacheKey('pk-cat', {
      category,
      country,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      scope,
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
        res.setHeader('X-PK-Scope', scope)
        res.setHeader('X-PK-Allowlist-Source', allowlistSource)
        res.setHeader('X-PK-Allowlist-Count', String(allowlist?.length || 0))
        res.setHeader('X-Provider', fresh.meta.provider)
        res.setHeader('X-Provider-Attempts', fresh.meta.attempts.join(','))
        if (fresh.meta.attemptsDetail)
          res.setHeader('X-Provider-Attempts-Detail', fresh.meta.attemptsDetail.join(','))
        res.setHeader('X-Provider-Articles', String(fresh.items.length))
        if (!getFresh(cacheKey)) res.setHeader('X-Cache-L2', '1')
        cache(res, 300, 60)
        await addCacheDebugHeaders(res, req)
        return res.status(200).json({ items: fresh.items })
      }
    }
    //
    res.setHeader('X-Cache', 'MISS')
    res.setHeader('X-PK-Scope', scope)
    res.setHeader('X-PK-Allowlist-Source', allowlistSource)
    res.setHeader('X-PK-Allowlist-Count', String(allowlist?.length || 0))
    // Use GNews-only providers
    const providers = getProvidersForPK()
    const result = await tryProvidersSequential(
      providers,
      'top',
      { page, pageSize, country, category, domains, sources, q: category },
      (url, headers) => upstreamJson(url, headers)
    )
    // Normalize and compute PK flags
    function getTld(host = '') {
      const h = String(host || '').toLowerCase()
      const parts = h.split('.')
      return parts.length >= 2 ? parts.slice(-1)[0] : ''
    }
    function inferSourceCountryFromDomain(host = ''): string | undefined {
      const h = String(host || '')
        .toLowerCase()
        .replace(/^www\./, '')
      const tld = getTld(h)
      if (tld === 'pk') return 'PK'
      if (isHostInAllowlist(h, allowlist)) return 'PK'
      return undefined
    }
    function detectCountriesFromText(title = '', summary = ''): string[] {
      const text = `${title} ${summary}`.toLowerCase()
      const hits = new Set<string>()
      const pkTerms = [
        'pakistan',
        'pakistani',
        'islamabad',
        'lahore',
        'karachi',
        'peshawar',
        'rawalpindi',
        'balochistan',
        'sindh',
        'punjab',
        'kpk',
        'gilgit-baltistan',
        'azad kashmir',
        'pak rupee',
        'pak govt',
      ]
      for (const term of pkTerms) {
        if (text.includes(term)) hits.add('PK')
      }
      return Array.from(hits)
    }
    function ensureFlags(n: any) {
      const host = String(n.sourceDomain || '')
      const country2 = inferSourceCountryFromDomain(host)
      n.sourceCountry = country2
      n.isFromPK = country2 === 'PK'
      if (!Array.isArray(n.mentionsCountries) || typeof n.isAboutPK !== 'boolean') {
        const arr = detectCountriesFromText(n.title || '', n.summary || '')
        n.mentionsCountries = arr
        n.isAboutPK = arr.includes('PK')
      }
      return n
    }
    let normalized = result.items.map(normalize).filter(Boolean).map(ensureFlags)
    // Apply scope filtering
    if (scope === 'from') {
      normalized = normalized.filter((n: any) => n.isFromPK)
    } else if (scope === 'about') {
      normalized = normalized.filter((n: any) => n.isAboutPK && !n.isFromPK)
    } else if (scope === 'union') {
      normalized = normalized.filter((n: any) => n.isFromPK || n.isAboutPK)
    }
    res.setHeader('X-Provider', result.provider)
    res.setHeader('X-Provider-Attempts', result.attempts?.join(',') || result.provider)
    if (result.attemptsDetail)
      res.setHeader('X-Provider-Attempts-Detail', result.attemptsDetail.join(','))
    if (domains.length) res.setHeader('X-PK-Domains', domains.join(','))
    if (sources.length) res.setHeader('X-PK-Sources', sources.join(','))
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
      await addCacheDebugHeaders(res, req)
      return res.status(200).json({
        items: normalized,
        debug: {
          provider: result.provider,
          url: result.url,
          attempts: result.attempts,
          attemptsDetail: result.attemptsDetail,
          cacheKey,
          noCache,
          scope,
          category,
          domains,
          sources,
        },
      })
    }
    await addCacheDebugHeaders(res, req)
    return res.status(200).json({ items: normalized })
  } catch (e: any) {
    const cacheKey = buildCacheKey('pk-cat', {
      category,
      country,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
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
    const status = Number(e?.status || (/\b(\d{3})\b/.exec(String(e?.message))?.[1] ?? '0'))
    if (status !== 429) setNegativeCache(cacheKey)
    if (String(req.query.debug) === '1') {
      await addCacheDebugHeaders(res, req)
      return res.status(500).json({
        error: 'Proxy failed',
        message: e?.message || String(e),
        hint: (e as any)?.hint,
      })
    }
    return res.status(500).json({ error: 'Proxy failed' })
  }
}

export default withHttpMetrics(handler)
