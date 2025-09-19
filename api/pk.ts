import { normalize } from '../lib/_normalize.js'
import { dedupeByTitle } from '../lib/_dedupe.js'
import { cors, cache, upstreamJson, addCacheDebugHeaders } from '../lib/_shared.js'
import { getFresh, getStale, setCache, getFreshOrL2 } from '../lib/_cache.js'
import { maybeScheduleRevalidate } from '../lib/_revalidate.js'
import { buildCacheKey } from '../lib/_key.js'
import { getProvidersForPK, tryProvidersSequential } from '../lib/_providers.js'
import { getUsedToday } from '../lib/_budget.js'
import { getInFlight, setInFlight } from '../lib/_inflight.js'
import {
  applyEntityHeaders,
  extractEntityMeta,
  isNotModified,
  attachEntityMeta,
} from '../lib/_http.js'
import { withHttpMetrics } from '../lib/_httpMetrics.js'

export default withHttpMetrics(async function handler(req: any, res: any) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  // Minimal rate limiting: 60 req / 60s per IP
  try {
    const RL_ENABLED = String(process.env.RL_ENABLED || '1') === '1'
    const RL_MAX = Math.max(1, parseInt(String(process.env.RL_MAX || '60'), 10) || 60)
    const RL_WINDOW_MS = Math.max(
      1000,
      parseInt(String(process.env.RL_WINDOW_MS || '60000'), 10) || 60000
    )
    const RL_RETRY_AFTER = String(process.env.RL_RETRY_AFTER || '30')
    if (!RL_ENABLED) throw new Error('RL disabled')
    const ip = String(
      req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || ''
    )
    const key = `rl:pk:${ip}`
    const now = Date.now()
    ;(globalThis as any).__rl = (globalThis as any).__rl || new Map<string, number[]>()
    const rl: Map<string, number[]> = (globalThis as any).__rl
    const arr = (rl.get(key) || []).filter((t) => now - t < RL_WINDOW_MS)
    if (arr.length >= RL_MAX) {
      res.setHeader('Retry-After', RL_RETRY_AFTER)
      return res.status(429).json({ error: 'Too Many Requests' })
    }
    arr.push(now)
    rl.set(key, arr)
  } catch {}
  const rawPage = String(req.query.page || '1')
  const pageNum = Math.max(1, parseInt(rawPage, 10) || 1)
  // Enforce fixed page size of 10 per request
  const pageSizeNum = 10
  const country = 'pk'
  const scope = String(req.query.scope || 'from') // 'from' | 'about'
  const pageToken = req.query.pageToken ? String(req.query.pageToken) : undefined
  // Optional filters: domains (site:), sources (treated as site:), q
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
    const cacheKey = buildCacheKey('pk-top', {
      country,
      scope,
      page: pageNum,
      pageSize: pageSizeNum,
      pageToken,
      domains,
      sources,
      q: q || undefined,
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
        // Apply entity headers before debug header export
        const meta = extractEntityMeta(fresh)
        if (meta) {
          if (isNotModified(req, meta)) {
            applyEntityHeaders(res, meta)
            await addCacheDebugHeaders(res, req)
            return res.status(304).end()
          }
          applyEntityHeaders(res, meta)
        }
        await addCacheDebugHeaders(res, req)
        // Opportunistic background revalidation
        maybeScheduleRevalidate(cacheKey, async () => {
          const providers = getProvidersForPK()
          const enforcedQ =
            scope === 'from' ? [q, 'site.country:PK'].filter(Boolean).join(' AND ') : q
          const result2 = await tryProvidersSequential(
            providers,
            'top',
            {
              page: pageNum,
              pageSize: pageSizeNum,
              country,
              domains,
              sources,
              q: enforcedQ,
              pinQ: scope === 'from',
              pageToken,
            },
            (url, headers) => upstreamJson(url, headers)
          )
          let normalized2 = result2.items.map(normalize).filter(Boolean)
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
            const knownPK = new Set(['brecorder.com', 'thefridaytimes.com'])
            if (knownPK.has(h)) return 'PK'
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
            if (typeof n.isFromPK !== 'boolean') {
              const host = String(n.sourceDomain || '')
              const country2 = inferSourceCountryFromDomain(host)
              n.sourceCountry = country2
              n.isFromPK = country2 === 'PK'
            }
            if (!Array.isArray(n.mentionsCountries) || typeof n.isAboutPK !== 'boolean') {
              const arr = detectCountriesFromText(n.title || '', n.summary || '')
              n.mentionsCountries = arr
              n.isAboutPK = arr.includes('PK')
            }
            return n
          }
          function rank(items: any[]) {
            const now = Date.now()
            const score = (it: any) => {
              const t = Date.parse(it.publishDate || it.publishedAt || '') || now
              const recency = 1 / Math.max(1, now - t)
              const aboutBoost = scope === 'about' && it.isAboutPK && !it.isFromPK ? 1.1 : 1
              return recency * aboutBoost
            }
            return items.slice().sort((a, b) => score(b) - score(a))
          }
          function dedupe(items: any[]) {
            const seen = new Set<string>()
            return items.filter((it) => {
              const key = String(it.url || it.link || it.id || '').toLowerCase()
              if (!key) return true
              if (seen.has(key)) return false
              seen.add(key)
              return true
            })
          }
          normalized2 = normalized2.map(ensureFlags)
          if (scope === 'from') normalized2 = normalized2.filter((n: any) => n.isFromPK)
          else if (scope === 'about') normalized2 = normalized2.filter((n: any) => n.isAboutPK)
          normalized2 = dedupe(rank(normalized2))
          if (String(process.env.FEATURE_TITLE_DEDUPE || '1') === '1') {
            const { dedupeByTitle } = await import('./_dedupe.js')
            normalized2 = dedupeByTitle(normalized2, 0.9)
          }
          return {
            items: normalized2,
            meta: {
              provider: result2.provider,
              attempts: result2.attempts || [result2.provider],
              attemptsDetail: result2.attemptsDetail,
            },
          }
        })
        // meta handled above
        return res.status(200).json({ items: fresh.items })
      }
    }
    // Miss path: attempt providers with in-flight dedupe
    res.setHeader('X-Cache', 'MISS')
    // Use Webz-only providers
    const providers = getProvidersForPK()
    const flightKey = `pk:${country}:${String(pageNum)}:${String(pageSizeNum)}:pt:${
      pageToken || ''
    }:d:${domains.join(',')}:s:${sources.join(',')}:q:${q}`
    let flight = getInFlight(flightKey)
    if (!flight) {
      // Enforce country filter for "from" scope via Webz field filter on Lite:
      // This adds site.country:PK to the query (Lite doesn't accept countries= param)
      const enforcedQ = scope === 'from' ? [q, 'site.country:PK'].filter(Boolean).join(' AND ') : q
      flight = setInFlight(
        flightKey,
        tryProvidersSequential(
          providers,
          'top',
          {
            page: pageNum,
            pageSize: pageSizeNum,
            country,
            domains,
            sources,
            q: enforcedQ,
            pinQ: scope === 'from',
            pageToken,
          },
          (url, headers) => upstreamJson(url, headers)
        )
      )
    }
    const result = await flight
    let normalized = result.items.map(normalize).filter(Boolean)
    // Compute/fallback flags if missing
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
      const knownPK = new Set(['brecorder.com', 'thefridaytimes.com'])
      if (knownPK.has(h)) return 'PK'
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
      if (typeof n.isFromPK !== 'boolean') {
        const host = String(n.sourceDomain || '')
        const country = inferSourceCountryFromDomain(host)
        n.sourceCountry = country
        n.isFromPK = country === 'PK'
      }
      if (!Array.isArray(n.mentionsCountries) || typeof n.isAboutPK !== 'boolean') {
        const arr = detectCountriesFromText(n.title || '', n.summary || '')
        n.mentionsCountries = arr
        n.isAboutPK = arr.includes('PK')
      }
      return n
    }
    function rank(items: any[]) {
      const now = Date.now()
      const score = (it: any) => {
        const t = Date.parse(it.publishDate || it.publishedAt || '') || now
        const recency = 1 / Math.max(1, now - t)
        const aboutBoost = scope === 'about' && it.isAboutPK && !it.isFromPK ? 1.1 : 1
        return recency * aboutBoost
      }
      return items.slice().sort((a, b) => score(b) - score(a))
    }
    function dedupe(items: any[]) {
      const seen = new Set<string>()
      return items.filter((it) => {
        const key = String(it.url || it.link || it.id || '').toLowerCase()
        if (!key) return true
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }
    normalized = normalized.map(ensureFlags)
    if (scope === 'from') normalized = normalized.filter((n: any) => n.isFromPK)
    else if (scope === 'about') normalized = normalized.filter((n: any) => n.isAboutPK)
    const preCount = normalized.length
    normalized = dedupe(rank(normalized))
    if (String(process.env.FEATURE_TITLE_DEDUPE || '1') === '1') {
      normalized = dedupeByTitle(normalized, 0.9)
    }
    res.setHeader('X-PK-Scope', scope)
    res.setHeader('X-Articles-PreDedupe', String(preCount))
    res.setHeader('X-Articles-PostDedupe', String(normalized.length))
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
    if (domains.length) res.setHeader('X-PK-Domains', domains.join(','))
    if (sources.length) res.setHeader('X-PK-Sources', sources.join(','))
    res.setHeader('X-Provider-Articles', String(normalized.length))
    if (scope === 'from') res.setHeader('X-PK-Enforced-Country', 'PK')
    // Budget usage observability (Webz)
    try {
      res.setHeader('X-Webz-Used-Today', String(getUsedToday('webz')))
    } catch {}
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
    // Schedule background revalidation for subsequent near-expiry windows
    maybeScheduleRevalidate(cacheKey, async () => {
      const providers = getProvidersForPK()
      const enforcedQ = scope === 'from' ? [q, 'site.country:PK'].filter(Boolean).join(' AND ') : q
      const result2 = await tryProvidersSequential(
        providers,
        'top',
        {
          page: pageNum,
          pageSize: pageSizeNum,
          country,
          domains,
          sources,
          q: enforcedQ,
          pinQ: scope === 'from',
          pageToken,
        },
        (url, headers) => upstreamJson(url, headers)
      )
      let normalized2 = result2.items.map(normalize).filter(Boolean)
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
        const knownPK = new Set(['brecorder.com', 'thefridaytimes.com'])
        if (knownPK.has(h)) return 'PK'
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
        if (typeof n.isFromPK !== 'boolean') {
          const host = String(n.sourceDomain || '')
          const country2 = inferSourceCountryFromDomain(host)
          n.sourceCountry = country2
          n.isFromPK = country2 === 'PK'
        }
        if (!Array.isArray(n.mentionsCountries) || typeof n.isAboutPK !== 'boolean') {
          const arr = detectCountriesFromText(n.title || '', n.summary || '')
          n.mentionsCountries = arr
          n.isAboutPK = arr.includes('PK')
        }
        return n
      }
      function rank(items: any[]) {
        const now = Date.now()
        const score = (it: any) => {
          const t = Date.parse(it.publishDate || it.publishedAt || '') || now
          const recency = 1 / Math.max(1, now - t)
          const aboutBoost = scope === 'about' && it.isAboutPK && !it.isFromPK ? 1.1 : 1
          return recency * aboutBoost
        }
        return items.slice().sort((a, b) => score(b) - score(a))
      }
      function dedupe(items: any[]) {
        const seen = new Set<string>()
        return items.filter((it) => {
          const key = String(it.url || it.link || it.id || '').toLowerCase()
          if (!key) return true
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      }
      normalized2 = normalized2.map(ensureFlags)
      if (scope === 'from') normalized2 = normalized2.filter((n: any) => n.isFromPK)
      else if (scope === 'about') normalized2 = normalized2.filter((n: any) => n.isAboutPK)
      normalized2 = dedupe(rank(normalized2))
      if (String(process.env.FEATURE_TITLE_DEDUPE || '1') === '1') {
        const { dedupeByTitle } = await import('./_dedupe.js')
        normalized2 = dedupeByTitle(normalized2, 0.9)
      }
      return {
        items: normalized2,
        meta: {
          provider: result2.provider,
          attempts: result2.attempts || [result2.provider],
          attemptsDetail: result2.attemptsDetail,
        },
      }
    })
    cache(res, 300, 60)
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
      const effectiveQ = scope === 'from' ? [q, 'site.country:PK'].filter(Boolean).join(' AND ') : q
      return res.status(200).json({
        items: normalized,
        debug: {
          provider: result.provider,
          url: result.url,
          attempts: result.attempts,
          attemptsDetail: result.attemptsDetail,
          cacheKey,
          noCache,
          country,
          domains,
          sources,
          q: effectiveQ || null,
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
    const page = String(req.query.page || '1')
    const pageSize = '10'
    const country = 'pk'
    const cacheKey = buildCacheKey('pk-top', {
      country,
      page: pageNum,
      pageSize: pageSizeNum,
      domains,
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
    // Pass through upstream 429 when no stale cache is available
    const status = Number(e?.status || (/(\b\d{3}\b)/.exec(String(e?.message))?.[1] ?? '0'))
    if (status === 429) {
      const ra = e?.retryAfter
      if (ra) res.setHeader('Retry-After', String(ra))
      return res
        .status(429)
        .json({ error: 'Rate limited', message: 'Upstream 429', retryAfter: ra || undefined })
    }
    if (String(req.query.debug) === '1') {
      return res.status(500).json({ error: 'Proxy failed', message: e?.message || String(e) })
    }
    return res.status(500).json({ error: 'Proxy failed' })
  }
})
