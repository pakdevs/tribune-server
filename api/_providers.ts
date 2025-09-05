import { recordSuccess, recordError, recordEmpty } from './_stats.js'

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export function getProvidersForPK() {
  const list: Array<{ type: string; key: string }> = []
  if ((process as any).env.GNEWS_API)
    list.push({ type: 'gnews', key: (process as any).env.GNEWS_API })
  return list
}

export function getProvidersForWorld() {
  const list: Array<{ type: string; key: string }> = []
  if ((process as any).env.GNEWS_API)
    list.push({ type: 'gnews', key: (process as any).env.GNEWS_API })
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
  const category: string | undefined = opts.category
    ? String(opts.category).toLowerCase()
    : undefined

  if (p.type === 'newsapi') {
    if (intent === 'top') {
      const params = new URLSearchParams({
        country,
        page: String(page),
        pageSize: String(pageSize),
      })
      if (category && category !== 'all' && category !== 'general') {
        params.set('category', category)
      }
      return {
        url: `https://newsapi.org/v2/top-headlines?${params.toString()}`,
        headers: { 'X-Api-Key': p.key },
        pick: (data: any) => data?.articles || [],
      }
    }
    if (intent === 'search' && q) {
      const params = new URLSearchParams({
        q,
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: String(pageSize),
        page: String(page),
      })
      if (domains && domains.length) params.set('domains', domains.join(','))
      return {
        url: `https://newsapi.org/v2/everything?${params.toString()}`,
        headers: { 'X-Api-Key': p.key },
        pick: (data: any) => data?.articles || [],
      }
    }
  }

  if (p.type === 'newsapi_pk') {
    if (intent === 'top') {
      const params = new URLSearchParams({
        q: 'Pakistan',
        language: 'en',
        sortBy: 'publishedAt',
        page: String(page),
        pageSize: String(pageSize),
      })
      return {
        url: `https://newsapi.org/v2/everything?${params.toString()}`,
        headers: { 'X-Api-Key': p.key },
        pick: (data: any) => data?.articles || [],
      }
    }
    if (intent === 'search' && q) {
      const params = new URLSearchParams({
        q,
        language: 'en',
        sortBy: 'publishedAt',
        page: String(page),
        pageSize: String(pageSize),
      })
      return {
        url: `https://newsapi.org/v2/everything?${params.toString()}`,
        headers: { 'X-Api-Key': p.key },
        pick: (data: any) => data?.articles || [],
      }
    }
  }

  if (p.type === 'gnews') {
    if (intent === 'top') {
      const params = new URLSearchParams({
        lang: 'en',
        country,
        max: String(pageSize),
        page: String(page),
      })
      const topicMap: Record<string, string> = {
        business: 'business',
        entertainment: 'entertainment',
        technology: 'technology',
        sports: 'sports',
        science: 'science',
        health: 'health',
        general: 'world',
      }
      if (category && topicMap[category]) params.set('topic', topicMap[category])
      params.set('apikey', p.key)
      return {
        url: `https://gnews.io/api/v4/top-headlines?${params.toString()}`,
        headers: {},
        pick: (data: any) => data?.articles || [],
      }
    }
    if (intent === 'search' && q) {
      const params = new URLSearchParams({
        q,
        lang: 'en',
        // pass through country to narrow sources by origin when available (e.g., pk)
        country,
        max: String(pageSize),
        page: String(page),
      })
      // prefer latest results first
      params.set('sortby', 'publishedAt')
      if (opts.from) params.set('from', String(opts.from))
      if (opts.to) params.set('to', String(opts.to))
      params.set('apikey', p.key)
      return {
        url: `https://gnews.io/api/v4/search?${params.toString()}`,
        headers: {},
        pick: (data: any) => data?.articles || [],
      }
    }
  }

  if (p.type === 'newsdata') {
    if (intent === 'search' && q) {
      const params = new URLSearchParams({ q, language: 'en', page: String(page) })
      if (domains && domains.length) params.set('domain', domains.join(','))
      params.set('apikey', p.key)
      return {
        url: `https://newsdata.io/api/1/news?${params.toString()}`,
        headers: {},
        pick: (data: any) => data?.results || data?.articles || [],
      }
    }
    const params = new URLSearchParams({ country, language: 'en', page: String(page) })
    if (category && category !== 'all') params.set('category', category)
    params.set('apikey', p.key)
    return {
      url: `https://newsdata.io/api/1/latest?${params.toString()}`,
      headers: {},
      pick: (data: any) => data?.results || data?.articles || [],
    }
  }

  if (p.type === 'worldnews') {
    const offset = (page - 1) * pageSize
    const params = new URLSearchParams({
      language: 'en',
      number: String(pageSize),
      offset: String(offset),
    })
    if (intent === 'search' && q) {
      params.set('text', q)
    } else if (category && category !== 'all') {
      params.set('text', category)
    }
    params.set('source-countries', country)
    params.set('api-key', p.key)
    return {
      url: `https://api.worldnewsapi.com/search-news?${params.toString()}`,
      headers: {},
      pick: (data: any) => data?.news || data?.articles || [],
    }
  }

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
  if (!providers.length) throw new Error('No providers configured')
  let ordered = providers
  const preferredIdx = providers.findIndex((p) => p.type === 'gnews')
  if (preferredIdx > 0) {
    ordered = [...providers]
    const [preferred] = ordered.splice(preferredIdx, 1)
    ordered.unshift(preferred)
  }
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i]
    attempts.push(p.type)
    try {
      const req = buildProviderRequest(p, intent, opts)
      if (!req) throw new Error('Unsupported request for provider')
      const json = await fetcher(req.url, req.headers)
      const items = req.pick(json)
      if (Array.isArray(items) && items.length) {
        recordSuccess(p.type, items.length)
        attemptsDetail.push(`${p.type}(ok:${items.length})`)
        return { items, provider: p.type, url: req.url, raw: json, attempts, attemptsDetail }
      }
      recordEmpty(p.type)
      attemptsDetail.push(`${p.type}(empty)`)
      throw new Error('Empty result')
    } catch (e: any) {
      recordError(p.type, e?.message || String(e))
      if (!attemptsDetail[attemptsDetail.length - 1]?.startsWith(p.type + '(')) {
        attemptsDetail.push(`${p.type}(err)`)
      }
      errors.push(`${p.type}: ${e?.message || e}`)
    }
  }
  const err: any = new Error(`All providers failed: ${errors.join(' | ')}`)
  err.details = errors
  err.attempts = attempts
  err.attemptsDetail = attemptsDetail
  throw err
}
