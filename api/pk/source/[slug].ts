import { normalize } from '../../_normalize.js'
import { cors, cache } from '../../_shared.js'
import { makeKey, getFresh, getStale, setCache } from '../../_cache.js'
import { getProvidersForPK, buildProviderRequest } from '../../_providers.js'
import { getInFlight, setInFlight } from '../../_inflight.js'

const slugify = (s = '') =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export default async function handler(req: any, res: any) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  const slug = slugify(req.query.slug || '')
  const name = String(req.query.name || '').trim()
  const domain = String(req.query.domain || '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
  const page = String(req.query.page || '1')
  const pageSize = String(req.query.pageSize || req.query.limit || '50')
  let country = 'pk'

  if (!slug && !name && !domain) {
    return res.status(400).json({ error: 'Missing source identifier' })
  }

  let q = name ? `"${name}"` : slug
  if (!q && domain) {
    const base = domain.split('.')
    if (base.length) q = base[0]
  }

  try {
    const cacheKey = makeKey(['source', 'pk', slug, domain, name, country, page, pageSize])
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
    const flightKey = `source:pk:${slug}:${domain}:${name}:${country}:${page}:${pageSize}`
    let flight = getInFlight(flightKey)
    if (!flight) {
      flight = setInFlight(
        flightKey,
        (async () => {
          let ordered = providers
          const preferredIdx = providers.findIndex((p) => p.type === 'gnews')
          if (preferredIdx > 0) {
            ordered = [...providers]
            const [preferred] = ordered.splice(preferredIdx, 1)
            ordered.unshift(preferred)
          }
          const attempts: string[] = []
          const attemptsDetail: string[] = []
          const targetSlug = slug
          const targetDomain = domain
          const nameLower = name.toLowerCase()
          const getHost = (u = '') => {
            try {
              const s = String(u)
              const i = s.indexOf('://')
              const x = i > -1 ? s.slice(i + 3) : s
              return x.split('/')[0].replace(/^www\./, '')
            } catch {
              return ''
            }
          }
          for (const p of ordered) {
            attempts.push(p.type)
            try {
              const reqSpec = buildProviderRequest(p, 'search', {
                page,
                pageSize,
                country,
                q,
                domains: targetDomain ? [targetDomain] : [],
              })
              if (!reqSpec) {
                attemptsDetail.push(`${p.type}(unsupported)`)
                continue
              }
              const json = await fetch(reqSpec.url, { headers: reqSpec.headers }).then((r) => {
                if (!r.ok) throw new Error('Upstream ' + r.status)
                return r.json()
              })
              const items = reqSpec.pick(json)
              if (!Array.isArray(items) || !items.length) {
                attemptsDetail.push(`${p.type}(empty)`)
                continue
              }
              const normalized = items.map(normalize).filter(Boolean)
              const filtered = normalized.filter((a: any) => {
                const aDomain = (a?.sourceDomain || '').toLowerCase()
                const aName = String(a?.displaySourceName || a?.sourceName || '').trim()
                const aSlug = slugify(aName)
                const domainMatch = targetDomain && aDomain ? aDomain.endsWith(targetDomain) : false
                const slugMatch = targetSlug && aSlug ? aSlug === targetSlug : false
                const nameMatch = nameLower ? aName.toLowerCase().includes(nameLower) : false
                let linkMatch = false
                if (targetDomain) {
                  const linkHost = getHost(a?.link || a?.url || '')
                  if (linkHost) linkMatch = linkHost.toLowerCase().endsWith(targetDomain)
                }
                return (domain ? domainMatch : false) || slugMatch || nameMatch || linkMatch
              })
              if (filtered.length) {
                attemptsDetail.push(`${p.type}(ok:${filtered.length})`)
                return {
                  items: filtered,
                  provider: p.type,
                  attempts,
                  attemptsDetail,
                }
              }
              attemptsDetail.push(`${p.type}(no-source-match)`)
            } catch (e) {
              attemptsDetail.push(`${p.type}(err)`)
            }
          }
          return { items: [], provider: attempts[0] || '', attempts, attemptsDetail }
        })()
      )
    }
    const result = await flight
    setCache(cacheKey, {
      items: result.items,
      meta: {
        provider: result.provider,
        attempts: result.attempts || [result.provider],
        attemptsDetail: result.attemptsDetail,
      },
    })
    res.setHeader('X-Provider', result.provider)
    res.setHeader('X-Provider-Attempts', result.attempts?.join(',') || result.provider)
    if (result.attemptsDetail)
      res.setHeader('X-Provider-Attempts-Detail', result.attemptsDetail.join(','))
    res.setHeader('X-Provider-Articles', String(result.items.length))
    cache(res, 300, 60)
    if (String(req.query.debug) === '1') {
      return res.status(200).json({
        items: result.items,
        debug: {
          attempts: result.attempts,
          attemptsDetail: result.attemptsDetail,
          q,
          country,
          slug,
          domain,
        },
      })
    }
    return res.status(200).json({ items: result.items })
  } catch (e: any) {
    const cacheKey = makeKey(['source', 'pk', slug, domain, name, country, page, pageSize])
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
