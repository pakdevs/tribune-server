import { recordSuccess, recordError, recordEmpty } from './_stats.js'
import { isCoolingDown, setCooldown } from './_cooldown.js'
import {
  getNewsDataApiKey,
  getWebzApiKey,
  getWebzUseLite,
  getWebzDailyLimit,
  getWebzCallCost,
} from './_env.js'
import { canSpend, spend, getUsedToday } from './_budget.js'

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export function getProvidersForPK() {
  const list: Array<{ type: string; key: string }> = []
  // NewsData.io supports country and sources directly
  const key = getNewsDataApiKey()
  if (key) list.push({ type: 'newsdata', key })
  const webz = getWebzApiKey()
  if (webz) list.push({ type: 'webz', key: webz })
  return list
}

export function getProvidersForWorld() {
  const list: Array<{ type: string; key: string }> = []
  const key = getNewsDataApiKey()
  if (key) list.push({ type: 'newsdata', key })
  const webz = getWebzApiKey()
  if (webz) list.push({ type: 'webz', key: webz })
  return list
}

export function buildProviderRequest(p: any, intent: 'top' | 'search', opts: any) {
  const page = clamp(parseInt(String(opts.page || '1'), 10) || 1, 1, 100000)
  const pageSize = clamp(parseInt(String(opts.pageSize || '50'), 10) || 50, 1, 100)
  const country = String(opts.country || 'us')
  const q: string | undefined = opts.q ? String(opts.q) : undefined
  const domains = Array.isArray(opts.domains)
    ? opts.domains.filter(Boolean)
    : opts.domains
    ? [String(opts.domains)]
    : []
  const sources = Array.isArray(opts.sources)
    ? opts.sources.filter(Boolean)
    : opts.sources
    ? [String(opts.sources)]
    : []
  const category: string | undefined = opts.category
    ? String(opts.category).toLowerCase()
    : undefined

  if (p.type === 'newsdata') {
    const pageSizeUsed = Math.min(10, pageSize)
    const params = new URLSearchParams({ apikey: p.key, language: 'en' })
    const includePagination = !opts?._noPagination
    const isPublicKey = String(p.key || '').startsWith('pub_')
    // NewsData 'page' is a token; avoid sending page=1. Use pageToken when provided; else only send numeric when >1.
    if (includePagination) {
      if (opts?.pageToken) {
        params.set('page', String(opts.pageToken))
      } else if (page > 1) {
        params.set('page', String(page))
      }
      if (!isPublicKey) {
        params.set('page_size', String(pageSizeUsed))
      }
    }
    // Filters common to both intents
    if (country) params.set('country', country)
    if (q) params.set('q', q)
    if (domains.length) params.set('domain', domains.join(','))
    if (sources.length) params.set('source_id', sources.join(','))
    if (opts.from) params.set('from_date', String(opts.from))
    if (opts.to) params.set('to_date', String(opts.to))

    // Category: skip 'general' and 'all' for NewsData
    if (category && category !== 'all' && category !== 'general') {
      params.set('category', category)
    }

    const base = 'https://newsdata.io/api/1/news'
    const url = `${base}?${params.toString()}`
    return { url, headers: {}, pick: (data: any) => data?.results || data?.articles || [] }
  }

  if (p.type === 'webz') {
    const useLite = getWebzUseLite()
    const params = new URLSearchParams()
    params.set('token', p.key)
    let query = q ? String(q) : ''
    if (domains.length) {
      const siteExpr = domains.map((d: string) => `site:${d}`).join(' OR ')
      query = query ? `${query} AND (${siteExpr})` : `(${siteExpr})`
    }
    if (sources.length) {
      const siteExpr = sources.map((s: string) => `site:${s}`).join(' OR ')
      query = query ? `${query} AND (${siteExpr})` : `(${siteExpr})`
    }
    if (!/\bsite_type:\w+/i.test(query)) {
      query = query ? `${query} AND site_type:news` : 'site_type:news'
    }
    if (query) params.set('q', query)

    let url: string
    let pick: (d: any) => any[]
    if (useLite) {
      // Lite endpoint: https://api.webz.io/newsApiLite
      // Returns up to 10 results and provides a next URL for pagination
      url = `https://api.webz.io/newsApiLite?${params.toString()}`
      pick = (d: any) => d?.posts || d?.articles || d?.results || []
    } else {
      // Full v3 endpoint with richer params
      if (opts.language) params.set('language', String(opts.language))
      if (country) params.set('countries', country)
      if (category && category !== 'all' && category !== 'general') params.set('category', category)
      const size = Math.min(100, Math.max(1, pageSize))
      params.set('size', String(size))
      const from = (page - 1) * size
      if (from > 0) params.set('from', String(from))
      if (opts.from) params.set('fromPublishedDate', String(opts.from))
      if (opts.to) params.set('toPublishedDate', String(opts.to))
      url = `https://api.webz.io/newsApi/v3/search?${params.toString()}`
      pick = (d: any) => d?.posts || d?.articles || d?.results || []
    }
    return { url, headers: {}, pick }
  }

  // Only NewsData provider supported
  return null
}

export async function tryProvidersSequential(
  providers: Array<{ type: string; key: string }>,
  intent: 'top' | 'search',
  opts: any,
  fetcher: (url: string, headers: Record<string, string>) => Promise<any>
) {
  const errors: string[] = []
  const attempts: string[] = []
  const attemptsDetail: string[] = []
  const errorDetails: string[] = []
  if (!providers.length) {
    const keyPresent = Boolean(getNewsDataApiKey())
    const hint = keyPresent
      ? 'NEWSDATA_API present but provider build failed'
      : 'Missing NEWSDATA_API. Set it in Vercel env or a local .env file.'
    const err: any = new Error('No providers configured')
    err.hint = hint
    throw err
  }
  // Use providers as supplied by getProviders* (but prefer Webz when source filters are present)
  let ordered = providers
  try {
    const hasDomains = Array.isArray(opts?.domains) && opts.domains.length > 0
    const hasSources = Array.isArray(opts?.sources) && opts.sources.length > 0
    if (hasDomains || hasSources) {
      ordered = [...providers].sort((a, b) => (a.type === 'webz' ? -1 : b.type === 'webz' ? 1 : 0))
    }
  } catch {}
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i]
    attempts.push(p.type)
    try {
      // Skip provider if cooling down (e.g., after 429)
      if (isCoolingDown(p.type)) {
        attemptsDetail.push(`${p.type}(cooldown)`)
        continue
      }
      // Budget gating for Webz
      if (p.type === 'webz') {
        const limit = getWebzDailyLimit()
        const cost = getWebzCallCost()
        const gate = canSpend('webz', limit, cost)
        if (!gate.ok) {
          attemptsDetail.push(`webz(skipped:${gate.reason})`)
          continue
        }
      }
      // Build attempt variants for NewsData to reduce 422/empty cases
      const variants: Array<{ label: string; o: any }> = []
      if (p.type === 'newsdata') {
        variants.push({ label: 'as-is', o: { ...opts } })
        variants.push({ label: 'no-pagination', o: { ...opts, _noPagination: true } })
        variants.push({ label: 'no-category', o: { ...opts, category: undefined } })
        variants.push({ label: 'no-domains-sources', o: { ...opts, domains: [], sources: [] } })
        variants.push({ label: 'no-q', o: { ...opts, q: undefined } })
        variants.push({ label: 'no-country', o: { ...opts, country: undefined } })
        variants.push({
          label: 'minimal',
          o: { page: opts.page, pageSize: opts.pageSize, country: opts.country },
        })
      } else if (p.type === 'webz') {
        variants.push({ label: 'as-is', o: { ...opts } })
        variants.push({ label: 'no-category', o: { ...opts, category: undefined } })
        variants.push({ label: 'no-domains-sources', o: { ...opts, domains: [], sources: [] } })
        variants.push({ label: 'no-q', o: { ...opts, q: undefined } })
        variants.push({ label: 'no-country', o: { ...opts, country: undefined } })
      } else {
        variants.push({ label: 'as-is', o: { ...opts } })
      }

      let lastAttemptUrl: string | undefined
      const runVariant = async (label: string, o: any) => {
        const req = buildProviderRequest(p, intent, o)
        if (!req) throw new Error('Unsupported request for provider')
        lastAttemptUrl = req.url
        try {
          const json = await fetcher(req.url, req.headers)
          // spend budget for Webz on each outward call
          if (p.type === 'webz') {
            spend('webz', getWebzCallCost())
          }
          // NewsData sometimes returns 200 with status: 'error' in body
          if (p.type === 'newsdata') {
            const statusField = String(json?.status || '').toLowerCase()
            if (statusField && statusField !== 'success') {
              const msg = json?.message || json?.results?.message || 'Upstream error'
              const errAny: any = new Error(`Upstream status:${statusField} ${msg}`)
              errAny.status = 422
              throw errAny
            }
          }
          let items = req.pick(json)
          if (Array.isArray(items) && items.length) {
            recordSuccess(p.type, items.length)
            attemptsDetail.push(`${p.type}:${label}(ok:${items.length})`)
            // Webz Lite pagination via next URL
            if (p.type === 'webz' && getWebzUseLite()) {
              const needMore = Math.max(0, (o?.pageSize || opts.pageSize || 0) - items.length)
              const pageNum = Math.max(1, parseInt(String(o?.page || opts.page || '1'), 10) || 1)
              // For Lite, each call returns up to 10; emulate page N by following next N-1 times
              let nextUrl: string | undefined = (json &&
                (json.next || json.nextPage || json.next_page)) as any
              let currentPage = 1
              while (needMore > 0 && nextUrl && currentPage < pageNum) {
                try {
                  const nextJson = await fetcher(String(nextUrl), req.headers)
                  spend('webz', getWebzCallCost())
                  const more = req.pick(nextJson)
                  if (Array.isArray(more) && more.length) {
                    items = items.concat(more)
                    nextUrl = (nextJson &&
                      (nextJson.next || nextJson.nextPage || nextJson.next_page)) as any
                    currentPage += 1
                  } else {
                    break
                  }
                } catch (e: any) {
                  errorDetails.push(`${p.type}:next(err:${e?.message || e})`)
                  break
                }
              }
              // Trim to requested page/pageSize if we overshot
              if ((o?.pageSize || opts.pageSize) && items.length > (o?.pageSize || opts.pageSize)) {
                items = items.slice(0, o?.pageSize || opts.pageSize)
              }
            }
            return { items, provider: p.type, url: req.url, raw: json }
          }
          recordEmpty(p.type)
          attemptsDetail.push(`${p.type}:${label}(empty)`)
          return null
        } catch (err: any) {
          const msg = String(err?.message || '')
          const status = err?.status || (msg.match(/\b(\d{3})\b/)?.[1] ?? '')
          if (String(status) === '422') {
            attemptsDetail.push(`${p.type}:${label}(422)`) // try next variant
            return null
          }
          attemptsDetail.push(`${p.type}:${label}(err)`) // record non-422 error
          errorDetails.push(`${p.type}:${label}: ${msg || 'error'}`)
          throw err
        }
      }

      for (const v of variants) {
        const res = await runVariant(v.label, v.o)
        if (res) return { ...res, attempts, attemptsDetail }
      }
      // All variants returned empty – treat as a successful, empty response
      recordEmpty(p.type)
      attemptsDetail.push(`${p.type}(empty-all)`)
      return {
        items: [],
        provider: p.type,
        url: lastAttemptUrl || '',
        raw: null,
        attempts,
        attemptsDetail,
      }
    } catch (e: any) {
      recordError(p.type, e?.message || String(e))
      if (!attemptsDetail[attemptsDetail.length - 1]?.startsWith(p.type + '(')) {
        attemptsDetail.push(`${p.type}(err)`) // ensure a provider-level error marker exists
      }
      // If upstream rate limited, set a short cooldown to avoid hammering
      const status = e?.status || (/\b(\d{3})\b/.exec(String(e?.message))?.[1] ?? '')
      if (String(status) === '429') {
        const retryAfter = parseInt(String(e?.retryAfter || ''), 10)
        setCooldown(
          p.type,
          Number.isFinite(retryAfter) ? Math.min(Math.max(retryAfter, 10), 120) : 30
        )
      }
      errors.push(`${p.type}: ${e?.message || e}`)
    }
  }
  const err: any = new Error(`All providers failed: ${errors.join(' | ')}`)
  err.details = errors
  err.attempts = attempts
  err.attemptsDetail = attemptsDetail
  err.errors = errorDetails
  throw err
}
