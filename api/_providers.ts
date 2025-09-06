import { recordSuccess, recordError, recordEmpty } from './_stats.js'
import { isCoolingDown, setCooldown } from './_cooldown.js'
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
    if (intent === 'search' && (q || (domains && domains.length))) {
      const params = new URLSearchParams({
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: String(pageSize),
        page: String(page),
      })
      if (q) params.set('q', q)
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
        language: 'en',
        sortBy: 'publishedAt',
        page: String(page),
        pageSize: String(pageSize),
      })
      const hasDomains = domains && domains.length > 0
      // Prefer caller-provided q (e.g., category or keyword). Otherwise, fall back to Pakistan (optionally with category)
      const explicitQ =
        typeof opts.q === 'string' && opts.q.trim() ? String(opts.q).trim() : undefined
      const fallbackQ = !hasDomains
        ? opts.category && String(opts.category).toLowerCase() !== 'general'
          ? `Pakistan ${String(opts.category)}`
          : 'Pakistan'
        : undefined
      const qFinal = explicitQ || fallbackQ
      if (qFinal) params.set('q', qFinal)
      if (hasDomains) params.set('domains', domains.join(','))
      return {
        url: `https://newsapi.org/v2/everything?${params.toString()}`,
        headers: { 'X-Api-Key': p.key },
        pick: (data: any) => data?.articles || [],
      }
    }
    if (intent === 'search' && (q || (domains && domains.length))) {
      const params = new URLSearchParams({
        language: 'en',
        sortBy: 'publishedAt',
        page: String(page),
        pageSize: String(pageSize),
      })
      if (q) params.set('q', q)
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
      ? 'NEWSAPI_* present but provider build failed'
      : 'Missing NEWSAPI_ORG (or NEWSAPI_KEY). Set it in Vercel env or a local .env file.'
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
      // Skip provider if cooling down (e.g., after 429)
      if (isCoolingDown(p.type)) {
        attemptsDetail.push(`${p.type}(cooldown)`)
        continue
      }
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
  throw err
}
