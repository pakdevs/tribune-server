import { recordSuccess, recordError, recordEmpty } from './_stats.js'
import { getNewsApiKey } from './_env.js'

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export function getProvidersForPK() {
  const list: Array<{ type: string; key: string }> = []
  // Prefer NewsAPI: Pakistan is not a supported country for top-headlines, so use a Pakistan-focused Everything query
  const key = getNewsApiKey()
  if (key) list.push({ type: 'newsapi_pk', key })
  return list
}

export function getProvidersForWorld() {
  const list: Array<{ type: string; key: string }> = []
  // Prefer NewsAPI for world headlines and search
  const key = getNewsApiKey()
  if (key) list.push({ type: 'newsapi', key })
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
  // Note: NewsAPI Everything does not support `sources` param (only Top Headlines does),
  // so we ignore opts.sources for Everything requests and rely on domains + q instead.
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
      if (opts.from) params.set('from', String(opts.from))
      if (opts.to) params.set('to', String(opts.to))
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
        q:
          opts.category && String(opts.category).toLowerCase() !== 'general'
            ? `Pakistan ${String(opts.category)}`
            : 'Pakistan',
        language: 'en',
        sortBy: 'publishedAt',
        page: String(page),
        pageSize: String(pageSize),
      })
      if (domains && domains.length) params.set('domains', domains.join(','))
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
      if (domains && domains.length) params.set('domains', domains.join(','))
      if (opts.from) params.set('from', String(opts.from))
      if (opts.to) params.set('to', String(opts.to))
      return {
        url: `https://newsapi.org/v2/everything?${params.toString()}`,
        headers: { 'X-Api-Key': p.key },
        pick: (data: any) => data?.articles || [],
      }
    }
  }

  // Only NewsAPI providers are supported at this time.

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
  if (!providers.length) {
    const keyPresent = Boolean(getNewsApiKey())
    const hint = keyPresent
      ? 'NEWSAPI_KEY present but provider build failed'
      : 'Missing NEWSAPI_KEY. Set it in Vercel env or a local .env file.'
    const err: any = new Error('No providers configured')
    err.hint = hint
    throw err
  }
  // Use providers as supplied by getProviders* (no special-casing GNews)
  let ordered = providers
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
