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
  const domain = req.query.domain ? String(req.query.domain).trim() : ''
  const rawPage = String(req.query.page || '1')
  const rawPageSize = String(req.query.pageSize || req.query.limit || '50')
  const pageNum = Math.max(1, parseInt(rawPage, 10) || 1)
  const pageSizeNum = Math.min(100, Math.max(1, parseInt(rawPageSize, 10) || 50))
  const from = req.query.from ? String(req.query.from) : undefined
  const to = req.query.to ? String(req.query.to) : undefined
  let country = 'pk'

  if (!slug && !name) {
    return res.status(400).json({ error: 'Missing source identifier' })
  }

  let q = name ? `"${name}"` : slug

  try {
    const cacheKey = makeKey([
      'source',
      'pk',
      slug,
      name,
      domain || '',
      country,
      String(pageNum),
      String(pageSizeNum),
      from || '',
      to || '',
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
    const flightKey = `source:pk:${slug}:${name}:${domain || ''}:${country}:${String(
      pageNum
    )}:${String(pageSizeNum)}:${from || ''}:${to || ''}`
    let flight = getInFlight(flightKey)
    if (!flight) {
      flight = setInFlight(
        flightKey,
        (async () => {
          let ordered = providers
          const attempts: string[] = []
          const attemptsDetail: string[] = []
          const targetSlug = slug
          const nameLower = name.toLowerCase()
          for (const p of ordered) {
            attempts.push(p.type)
            try {
              const reqSpec = buildProviderRequest(p, 'search', {
                page: pageNum,
                pageSize: pageSizeNum,
                country,
                q,
                domains: domain ? [domain] : [],
                from,
                to,
              })
              if (!reqSpec) {
                attemptsDetail.push(`${p.type}(unsupported)`)
                continue
              }
              const controller = new AbortController()
              const timeoutId = setTimeout(() => controller.abort(), 8000)
              const json = await fetch(reqSpec.url, {
                headers: reqSpec.headers,
                signal: controller.signal,
              })
                .then((r) => {
                  if (!r.ok) throw new Error('Upstream ' + r.status)
                  return r.json()
                })
                .finally(() => clearTimeout(timeoutId))
              const items = reqSpec.pick(json)
              if (!Array.isArray(items) || !items.length) {
                attemptsDetail.push(`${p.type}(empty)`)
                continue
              }
              const normalized = items.map(normalize).filter(Boolean)
              const filtered = normalized.filter((a: any) => {
                const aName = String(a?.displaySourceName || a?.sourceName || '').trim()
                const aSlug = slugify(aName)
                const slugMatch = targetSlug && aSlug ? aSlug === targetSlug : false
                const nameMatch = nameLower ? aName.toLowerCase().includes(nameLower) : false
                return slugMatch || nameMatch
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
          from,
          to,
        },
      })
    }
    return res.status(200).json({ items: result.items })
  } catch (e: any) {
    const cacheKey = makeKey([
      'source',
      'pk',
      slug,
      name,
      country,
      String(pageNum),
      String(pageSizeNum),
      from || '',
      to || '',
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
    if (String(req.query.debug) === '1')
      return res.status(500).json({ error: 'Proxy failed', message: e?.message || String(e) })
    return res.status(500).json({ error: 'Proxy failed' })
  }
}
