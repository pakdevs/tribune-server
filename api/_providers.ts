import { recordSuccess, recordError, recordEmpty } from './_stats.js'
import { isCoolingDown, setCooldown } from './_cooldown.js'
import { getWebzApiKey, getWebzUseLite, getWebzDailyLimit, getWebzCallCost } from './_env.js'
import { canSpend, spend, getUsedToday } from './_budget.js'

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export function getProvidersForPK() {
  const list: Array<{ type: string; key: string }> = []
  const webz = getWebzApiKey()
  if (webz) list.push({ type: 'webz', key: webz })
  return list
}

export function getProvidersForWorld() {
  const list: Array<{ type: string; key: string }> = []
  const webz = getWebzApiKey()
  if (webz) list.push({ type: 'webz', key: webz })
  return list
}

export function buildProviderRequest(p: any, intent: 'top' | 'search', opts: any) {
  const page = clamp(parseInt(String(opts.page || '1'), 10) || 1, 1, 100000)
  // Enforce fixed page size of 10 regardless of inbound value
  const pageSize = 10
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
      params.set('size', '10')
      const from = (page - 1) * 10
      if (from > 0) params.set('from', String(from))
      if (opts.from) params.set('fromPublishedDate', String(opts.from))
      if (opts.to) params.set('toPublishedDate', String(opts.to))
      url = `https://api.webz.io/newsApi/v3/search?${params.toString()}`
      pick = (d: any) => d?.posts || d?.articles || d?.results || []
    }
    return { url, headers: {}, pick }
  }
  // No other providers supported
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
    const err: any = new Error('No providers configured (WEBZ_API missing)')
    err.hint = 'Set WEBZ_API in your environment (Vercel env or local .env)'
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
      const variants: Array<{ label: string; o: any }> = []
      if (p.type === 'webz') {
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
          // No special status handling needed for Webz
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
