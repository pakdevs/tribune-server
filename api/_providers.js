// Shared provider helpers for multiple upstreams
import { recordSuccess, recordError, recordEmpty } from './_stats.js'

const clamp = (n, min, max) => Math.min(max, Math.max(min, n))

export function getProvidersForPK() {
  const list = []
  if (process.env.NEWSDATA_API) list.push({ type: 'newsdata', key: process.env.NEWSDATA_API })
  if (process.env.WORLD_NEWS_API) list.push({ type: 'worldnews', key: process.env.WORLD_NEWS_API })
  if (process.env.GNEWS_API) list.push({ type: 'gnews', key: process.env.GNEWS_API })
  // Fallback: use NewsAPI Everything search (q=Pakistan) when all PK-capable providers fail / are empty
  if (process.env.NEWSAPI_ORG) list.push({ type: 'newsapi_pk', key: process.env.NEWSAPI_ORG })
  return list
}

export function getProvidersForWorld() {
  const list = []
  // Start with the higher quota first
  if (process.env.NEWSDATA_API) list.push({ type: 'newsdata', key: process.env.NEWSDATA_API })
  if (process.env.NEWSAPI_ORG) list.push({ type: 'newsapi', key: process.env.NEWSAPI_ORG })
  if (process.env.WORLD_NEWS_API) list.push({ type: 'worldnews', key: process.env.WORLD_NEWS_API })
  if (process.env.GNEWS_API) list.push({ type: 'gnews', key: process.env.GNEWS_API })
  return list
}

// Build a request for a given provider and intent ('top' or 'search')
export function buildProviderRequest(p, intent, opts) {
  const page = clamp(parseInt(opts.page || '1', 10) || 1, 1, 100000)
  const pageSize = clamp(parseInt(opts.pageSize || '50', 10) || 50, 1, 100)
  const country = String(opts.country || 'us')
  const q = opts.q ? String(opts.q) : undefined
  const category = opts.category ? String(opts.category).toLowerCase() : undefined

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
        pick: (data) => data?.articles || [],
      }
    }
    if (intent === 'search' && q) {
      const params = new URLSearchParams({
        q,
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: String(pageSize),
      })
      return {
        url: `https://newsapi.org/v2/everything?${params.toString()}`,
        headers: { 'X-Api-Key': p.key },
        pick: (data) => data?.articles || [],
      }
    }
  }

  if (p.type === 'newsapi_pk') {
    if (intent === 'top') {
      // Pakistan fallback: Everything search sorted by time
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
        pick: (data) => data?.articles || [],
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
        pick: (data) => data?.articles || [],
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
      // Map our categories to GNews "topic" values
      const topicMap = {
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
        pick: (data) => data?.articles || [],
      }
    }
    if (intent === 'search' && q) {
      const params = new URLSearchParams({
        q,
        lang: 'en',
        max: String(pageSize),
        page: String(page),
      })
      params.set('apikey', p.key)
      return {
        url: `https://gnews.io/api/v4/search?${params.toString()}`,
        headers: {},
        pick: (data) => data?.articles || [],
      }
    }
  }

  if (p.type === 'newsdata') {
    // NewsData.io: use /latest for 'top', /news (search) when q provided.
    if (intent === 'search' && q) {
      const params = new URLSearchParams({ q, language: 'en', page: String(page) })
      params.set('apikey', p.key)
      return {
        url: `https://newsdata.io/api/1/news?${params.toString()}`,
        headers: {},
        pick: (data) => data?.results || data?.articles || [],
      }
    }
    const params = new URLSearchParams({ country, language: 'en', page: String(page) })
    if (category && category !== 'all') params.set('category', category)
    params.set('apikey', p.key)
    return {
      url: `https://newsdata.io/api/1/latest?${params.toString()}`,
      headers: {},
      pick: (data) => data?.results || data?.articles || [],
    }
  }

  if (p.type === 'worldnews') {
    // WorldNews API: For 'search' use text=q, for 'top' approximate via category keyword or omit.
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
    // 'source-countries' can reduce diversity; only include if country seems specific (not 'us' generic search?). Keep simple: always include.
    params.set('source-countries', country)
    params.set('api-key', p.key)
    return {
      url: `https://api.worldnewsapi.com/search-news?${params.toString()}`,
      headers: {},
      pick: (data) => data?.news || data?.articles || [],
    }
  }

  return null
}

export async function tryProvidersSequential(providers, intent, opts, fetcher) {
  const errors = []
  const attempts = []
  const attemptsDetail = []
  if (!providers.length) throw new Error('No providers configured')
  // Always prioritize 'newsdata' first if present, then follow declared order.
  // This overrides the previous minute-based rotation so that NewsData gets first-request preference.
  let ordered = providers
  const preferredIdx = providers.findIndex((p) => p.type === 'newsdata')
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
      attemptsDetail.push(`${p.type}(empty)`) // treat as failure and continue
      throw new Error('Empty result')
    } catch (e) {
      recordError(p.type, e?.message || String(e))
      if (!attemptsDetail[attemptsDetail.length - 1]?.startsWith(p.type + '(')) {
        attemptsDetail.push(`${p.type}(err)`) // only add if not already tagged as empty
      }
      errors.push(`${p.type}: ${e?.message || e}`)
    }
  }
  const err = new Error(`All providers failed: ${errors.join(' | ')}`)
  err.details = errors
  err.attempts = attempts
  err.attemptsDetail = attemptsDetail
  throw err
}
