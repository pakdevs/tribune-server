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
  // domain parameter is ignored to avoid NewsData plan restrictions
  const domain = ''
  const rawPage = String(req.query.page || '1')
  const rawPageSize = String(req.query.pageSize || req.query.limit || '20')
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
          const domainLower = ''
          for (const p of ordered) {
            attempts.push(p.type)
            try {
              // Build strategy fallbacks: prefer NewsData source_id when possible, then q-only
              const strategies: Array<{
                label: string
                q?: string
                domains?: string[]
                sources?: string[]
              }> = []
              const nameSlug = nameLower ? slugify(nameLower) : ''
              if (slug) strategies.push({ label: 'sources(slug)', sources: [slug] })
              if (nameSlug && nameSlug !== slug)
                strategies.push({ label: 'sources(name)', sources: [nameSlug] })
              if (slug) strategies.push({ label: 'sources+name(slug)', sources: [slug], q })
              if (nameSlug && nameSlug !== slug)
                strategies.push({ label: 'sources+name(name)', sources: [nameSlug], q })
              strategies.push({ label: 'q-only', q })
              // Try each strategy with sub-variants to handle NewsData quirks (e.g., public keys pagination)
              let best: { items: any[] } | null = null
              for (const s of strategies) {
                const subVariants: Array<{
                  label: string
                  _noPagination?: boolean
                  _noCountry?: boolean
                }> = [
                  { label: `${s.label}` },
                  { label: `${s.label}-no-pagination`, _noPagination: true },
                ]
                subVariants.push({ label: `${s.label}-no-country`, _noCountry: true })
                subVariants.push({
                  label: `${s.label}-no-country-no-pagination`,
                  _noCountry: true,
                  _noPagination: true,
                })
                for (const sub of subVariants) {
                  try {
                    const reqSpec = buildProviderRequest(p, 'search', {
                      page: pageNum,
                      pageSize: pageSizeNum,
                      country: sub._noCountry ? undefined : country,
                      q: s.q,
                      domains: [],
                      sources: s.sources || [],
                      from,
                      to,
                      _noPagination: sub._noPagination,
                    })
                    if (!reqSpec) {
                      attemptsDetail.push(`${p.type}:${sub.label}(unsupported)`)
                      continue
                    }
                    const controller = new AbortController()
                    const timeoutId = setTimeout(() => controller.abort(), 8000)
                    const json = await fetch(reqSpec.url, {
                      headers: reqSpec.headers,
                      signal: controller.signal,
                    })
                      .then(async (r) => {
                        if (!r.ok) {
                          const err: any = new Error('Upstream ' + r.status)
                          err.status = r.status
                          throw err
                        }
                        return r.json()
                      })
                      .finally(() => clearTimeout(timeoutId))
                    // NewsData may return 200 with status:error
                    if (p.type === 'newsdata') {
                      const statusField = String((json as any)?.status || '').toLowerCase()
                      if (statusField && statusField !== 'success') {
                        attemptsDetail.push(`${p.type}:${sub.label}(status:${statusField})`)
                        continue
                      }
                    }
                    const items = reqSpec.pick(json)
                    if (!Array.isArray(items) || !items.length) {
                      attemptsDetail.push(`${p.type}:${sub.label}(empty)`)
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
                      attemptsDetail.push(`${p.type}:${sub.label}(ok:${filtered.length})`)
                      best = { items: filtered }
                      break
                    }
                    attemptsDetail.push(`${p.type}:${sub.label}(no-source-match)`)
                  } catch (err: any) {
                    const msg = String(err?.message || '')
                    const status = err?.status || (msg.match(/\b(\d{3})\b/)?.[1] ?? '')
                    if (String(status) === '422') {
                      attemptsDetail.push(`${p.type}:${sub.label}(422)`) // try next sub-variant
                      continue
                    }
                    attemptsDetail.push(`${p.type}:${sub.label}(err)`) // continue trying others
                    continue
                  }
                }
                if (best) break
              }
              if (best) {
                return {
                  items: best.items,
                  provider: p.type,
                  attempts,
                  attemptsDetail,
                }
              }
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
          domain,
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
      return res.status(500).json({
        error: 'Proxy failed',
        message: e?.message || String(e),
        hint: (e as any)?.hint,
      })
    return res.status(500).json({ error: 'Proxy failed' })
  }
}
