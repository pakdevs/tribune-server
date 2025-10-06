import { normalize } from '../../../lib/_normalize.js'
import { PK_BUSINESS_CONCEPT_URIS, PK_TERMS, buildPakistanOrQuery } from '../../../lib/pkTerms.js'
import { getPkAllowlistMeta, isHostInAllowlist } from '../../../lib/pkAllowlist.js'
const PK_ALLOWLIST_ENABLED = String(process.env.FEATURE_PK_ALLOWLIST || '0') === '1'
import { cors, cache, upstreamJson, addCacheDebugHeaders } from '../../../lib/_shared.js'
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
  const pageSize = String(req.query.pageSize || req.query.limit || '100')
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
  let allowlistSource = PK_ALLOWLIST_ENABLED ? 'seed' : 'disabled'
  if (PK_ALLOWLIST_ENABLED) {
    try {
      const meta = await getPkAllowlistMeta()
      allowlist = meta.list
      allowlistSource = meta.source || 'seed'
    } catch {}
  }
  try {
    const baseKeyParts = {
      category,
      country,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      domains,
      sources,
    }
    const cacheKey = buildCacheKey('pk-cat', { ...baseKeyParts, scope })
    const unionKey = buildCacheKey('pk-cat', { ...baseKeyParts, scope: 'union' })
    // Removed: separate about-all canonical key (no longer needed since about scope is standalone)
    const noCache = String(req.query.nocache || '0') === '1'
    if (!noCache) {
      const any = getAny(cacheKey)
      if (any && any.negative) {
        res.setHeader('X-Cache', 'NEGATIVE')
        cache(res, 30, 30)
        await addCacheDebugHeaders(res, req)
        return res.status(200).json({ items: [], negative: true })
      }
      // Try union canonical cache first (shared for 'from', 'about', and 'union')
      {
        const freshUnion = getFresh(unionKey) || (await getFreshOrL2(unionKey))
        let unionItems: any[] | null = null
        if (freshUnion) unionItems = freshUnion.items || []
        // If union missing or empty, try to compose from cached 'about' scope too
        if (!unionItems || unionItems.length === 0) {
          const aboutKey = buildCacheKey('pk-cat', { ...baseKeyParts, scope: 'about' })
          const cachedAbout = getFresh(aboutKey) || (await getFreshOrL2(aboutKey))
          if (cachedAbout && cachedAbout.items?.length) {
            unionItems = [
              ...(unionItems || []),
              ...cachedAbout.items.filter((n: any) => n?.isAboutPK && !n?.isFromPK),
            ]
          }
        }
        if (unionItems && unionItems.length) {
          let items = unionItems
          if (scope === 'from') items = items.filter((n: any) => n?.isFromPK)
          else if (scope === 'about') items = items.filter((n: any) => n?.isAboutPK && !n?.isFromPK)
          else if (scope === 'union') items = items.filter((n: any) => n?.isFromPK || n?.isAboutPK)
          res.setHeader('X-Cache', 'HIT')
          res.setHeader('X-PK-Scope', scope)
          res.setHeader('X-PK-Allowlist-Source', allowlistSource)
          res.setHeader('X-PK-Allowlist-Count', String(allowlist?.length || 0))
          // Provider headers from union cache if present
          if (freshUnion?.meta) {
            res.setHeader('X-Provider', freshUnion.meta.provider)
            res.setHeader('X-Provider-Attempts', freshUnion.meta.attempts.join(','))
            if (freshUnion.meta.attemptsDetail)
              res.setHeader('X-Provider-Attempts-Detail', freshUnion.meta.attemptsDetail.join(','))
          }
          res.setHeader('X-Provider-Articles', String(items.length))
          res.setHeader('X-Cache-Tier', getFresh(unionKey) ? 'L1' : 'L2')
          cache(res, 300, 60)
          await addCacheDebugHeaders(res, req)
          return res.status(200).json({ items })
        }
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
        if (!getFresh(cacheKey)) {
          res.setHeader('X-Cache-Tier', 'L2')
        } else {
          res.setHeader('X-Cache-Tier', 'L1')
        }
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
    // Use NewsAPI.ai provider list
    const providers = getProvidersForPK()
    // Always compose union once (top + about-search), then filter subset for requested scope
    const aboutQuery = `${category} ${buildPakistanOrQuery(8)}`.trim()
    const [topRes, aboutRes] = await Promise.all([
      tryProvidersSequential(
        providers,
        'top' as any,
        { page, pageSize, country, category, domains, sources },
        (request: any) => upstreamJson(request)
      ),
      tryProvidersSequential(
        providers,
        'search' as any,
        {
          page,
          pageSize,
          country: undefined,
          category,
          domains,
          sources,
          q: aboutQuery,
          pinQ: true,
          conceptUris: PK_BUSINESS_CONCEPT_URIS,
        },
        (request: any) => upstreamJson(request)
      ),
    ])
    const requestPairs: Array<[string, any]> = []
    if (topRes?.request) requestPairs.push(['top', { intent: 'top', ...topRes.request }])
    if (aboutRes?.request) requestPairs.push(['about', { intent: 'search', ...aboutRes.request }])
    let requestMeta: any
    if (requestPairs.length === 1) requestMeta = requestPairs[0][1]
    else if (requestPairs.length > 1) requestMeta = Object.fromEntries(requestPairs)

    const result = {
      items: [...(topRes?.items || []), ...(aboutRes?.items || [])],
      provider: topRes?.provider || aboutRes?.provider,
      attempts: (topRes?.attempts || []).concat(aboutRes?.attempts || []),
      attemptsDetail: (topRes?.attemptsDetail || []).concat(aboutRes?.attemptsDetail || []),
      url: `${topRes?.url || ''} || ${aboutRes?.url || ''}`,
      request: requestMeta,
    }
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
      if (PK_ALLOWLIST_ENABLED && isHostInAllowlist(h, allowlist)) return 'PK'
      return undefined
    }
    function detectCountriesFromText(title = '', summary = ''): string[] {
      const text = `${title} ${summary}`.toLowerCase()
      const hits = new Set<string>()
      for (const term of PK_TERMS) {
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
    const allNormalized = result.items.map(normalize).filter(Boolean).map(ensureFlags)
    const normalized = ((): any[] => {
      if (scope === 'from') return allNormalized.filter((n: any) => n.isFromPK)
      if (scope === 'about') return allNormalized.filter((n: any) => n.isAboutPK && !n.isFromPK)
      if (scope === 'union') return allNormalized.filter((n: any) => n.isFromPK || n.isAboutPK)
      return allNormalized
    })()
    res.setHeader('X-Provider', result.provider)
    res.setHeader('X-Provider-Attempts', result.attempts?.join(',') || result.provider)
    if (result.attemptsDetail)
      res.setHeader('X-Provider-Attempts-Detail', result.attemptsDetail.join(','))
    if (domains.length) res.setHeader('X-PK-Domains', domains.join(','))
    if (sources.length) res.setHeader('X-PK-Sources', sources.join(','))
    res.setHeader('X-Provider-Articles', String(normalized.length))
    // Write canonical payload for union scope reuse (always)
    setCache(unionKey, {
      items: allNormalized,
      meta: {
        provider: result.provider,
        url: result.url,
        request: result.request,
        cacheKey: unionKey,
        attempts: result.attempts || [result.provider],
        attemptsDetail: result.attemptsDetail,
      },
    })
    // Also write the scope-specific payload (compat)
    setCache(cacheKey, {
      items: normalized,
      meta: {
        provider: result.provider,
        url: result.url,
        request: result.request,
        cacheKey,
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
          request: result.request,
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

export default handler
