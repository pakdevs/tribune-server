import { recordSuccess, recordError, recordEmpty } from './_stats.js'
import { isCoolingDown, setCooldown } from './_cooldown.js'
import { getNewsApiAiKey, getNewsApiAiDailyLimit, getNewsApiAiCallCost } from './_env.js'
import { canSpend, spend } from './_budget.js'
import * as breaker from './_breaker.js'

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export type ProviderType = 'newsapi-ai'

export type ProviderConfig = { type: ProviderType; key: string }

export type ProviderFetchParams = {
  url: string
  headers: Record<string, string>
  method?: string
  body?: any
  timeoutMs?: number
}

export type ProviderRequest = ProviderFetchParams & {
  pick: (data: any) => any[]
}

const DEFAULT_NEWSAPI_ENDPOINT = 'https://newsapi.ai/api/v1/article/getArticles'
const NEWSAPI_ENDPOINT = String(
  (process as any)?.env?.NEWSAPI_AI_ENDPOINT || DEFAULT_NEWSAPI_ENDPOINT
)

const CATEGORY_CONCEPT_MAP: Record<string, string> = {
  general: 'http://en.wikipedia.org/wiki/News',
  world: 'http://en.wikipedia.org/wiki/World',
  business: 'http://en.wikipedia.org/wiki/Business',
  technology: 'http://en.wikipedia.org/wiki/Technology',
  tech: 'http://en.wikipedia.org/wiki/Technology',
  entertainment: 'http://en.wikipedia.org/wiki/Entertainment',
  sports: 'http://en.wikipedia.org/wiki/Sport',
  science: 'http://en.wikipedia.org/wiki/Science',
  health: 'http://en.wikipedia.org/wiki/Health',
  politics: 'http://en.wikipedia.org/wiki/Politics',
}

function normalizeLanguage(lang: any, fallback = 'en') {
  const value = String(lang || '')
    .trim()
    .toLowerCase()
  if (!value) return fallback
  if (/^[a-z]{2}$/.test(value)) return value
  return fallback
}

function buildNewsApiAiRequest(
  provider: ProviderConfig,
  intent: 'top' | 'search',
  opts: any
): ProviderRequest {
  const page = clamp(parseInt(String(opts.page || '1'), 10) || 1, 1, 100000)
  const pageSize = clamp(parseInt(String(opts.pageSize || '10'), 10) || 10, 1, 100)
  const language = normalizeLanguage(opts.language, 'en')
  const country = (() => {
    const raw = String(opts.country || '').trim()
    if (!raw) return undefined
    const upper = raw.toUpperCase()
    return /^[A-Z]{2}$/.test(upper) ? `country/${upper}` : undefined
  })()
  const q: string | undefined = opts.q ? String(opts.q).trim() : undefined
  const category: string | undefined = opts.category
    ? String(opts.category).toLowerCase()
    : undefined

  const queryClauses: any[] = []
  if (q) {
    queryClauses.push({ keyword: q, keywordLoc: 'body' })
  }
  if (category && CATEGORY_CONCEPT_MAP[category]) {
    queryClauses.push({ conceptUri: CATEGORY_CONCEPT_MAP[category] })
  }
  if (intent === 'top' && !q && country) {
    queryClauses.push({ locationUri: country })
  }
  if (!queryClauses.length) {
    queryClauses.push({ keyword: 'news', keywordLoc: 'title' })
  }

  const filter: Record<string, any> = {
    lang: [language],
  }
  if (country) {
    filter.sourceLocationUri = [country]
  }

  const body = {
    apiKey: provider.key,
    query: {
      $query: { $and: queryClauses },
      $filter: filter,
    },
    resultType: 'articles',
    articles: {
      page,
      count: pageSize,
      sortBy: intent === 'top' ? 'sourceImportance' : 'date',
      sortByAsc: false,
      articleBodyLen: -1,
      articleHasDuplicate: 'skipDuplicates',
      articleHasImage: true,
    },
  }

  const pick = (d: any) => {
    if (!d) return []
    if (Array.isArray(d.articles)) return d.articles
    if (Array.isArray(d.results)) return d.results
    if (Array.isArray(d?.articles?.results)) return d.articles.results
    if (Array.isArray(d?.data?.articles)) return d.data.articles
    return []
  }

  return {
    url: NEWSAPI_ENDPOINT,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    pick,
  }
}

export function getProvidersForPK(): ProviderConfig[] {
  const list: ProviderConfig[] = []
  const key = getNewsApiAiKey()
  if (key) list.push({ type: 'newsapi-ai', key })
  return list
}

export function getProvidersForPKTop(): ProviderConfig[] {
  const list: ProviderConfig[] = []
  const key = getNewsApiAiKey()
  if (key) list.push({ type: 'newsapi-ai', key })
  return list
}

export function getProvidersForWorld(): ProviderConfig[] {
  const list: ProviderConfig[] = []
  const key = getNewsApiAiKey()
  if (key) list.push({ type: 'newsapi-ai', key })
  return list
}

export function buildProviderRequest(
  provider: ProviderConfig,
  intent: 'top' | 'search',
  opts: any
): ProviderRequest | null {
  if (provider.type === 'newsapi-ai') {
    return buildNewsApiAiRequest(provider, intent, opts)
  }
  return null
}

export async function tryProvidersSequential(
  providers: ProviderConfig[],
  intent: 'top' | 'search',
  opts: any,
  fetcher: (params: ProviderFetchParams) => Promise<any>
) {
  const errors: string[] = []
  const attempts: string[] = []
  const attemptsDetail: string[] = []
  const errorDetails: string[] = []
  if (!providers.length) {
    const err: any = new Error('No providers configured (NEWSAPI_AI missing)')
    err.hint = 'Set NEWSAPI_AI in your environment (Vercel env or local .env)'
    throw err
  }
  const ordered = providers
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i]
    attempts.push(p.type)
    try {
      if (isCoolingDown(p.type)) {
        attemptsDetail.push(`${p.type}(cooldown)`)
        continue
      }
      if (!breaker.allowRequest(p.type)) {
        attemptsDetail.push(`${p.type}(breaker-open)`)
        continue
      }
      if (p.type === 'newsapi-ai') {
        const limit = getNewsApiAiDailyLimit()
        const cost = getNewsApiAiCallCost()
        const gate = canSpend('newsapi-ai', limit, cost)
        if (!gate.ok) {
          attemptsDetail.push(`newsapi-ai(skipped:${gate.reason})`)
          continue
        }
      }

      const variants: Array<{ label: string; o: any }> = []
      const pinQ = Boolean((opts as any)?.pinQ)
      variants.push({ label: 'as-is', o: { ...opts } })
      if (!pinQ) variants.push({ label: 'no-q', o: { ...opts, q: undefined } })
      variants.push({ label: 'no-country', o: { ...opts, country: undefined } })
      if (!pinQ)
        variants.push({
          label: 'no-country-no-q',
          o: { ...opts, country: undefined, q: undefined },
        })
      variants.push({ label: 'topic-only', o: { ...opts, q: undefined, page: 1 } })

      let lastAttemptUrl: string | undefined
      const runVariant = async (label: string, o: any) => {
        const req = buildProviderRequest(p, intent, o)
        if (!req) throw new Error('Unsupported request for provider')
        lastAttemptUrl = req.url
        try {
          const { pick, ...fetchParams } = req
          const json = await fetcher(fetchParams)
          if (p.type === 'newsapi-ai') {
            spend('newsapi-ai', getNewsApiAiCallCost())
          }
          const items = pick(json)
          if (Array.isArray(items) && items.length) {
            recordSuccess(p.type, items.length)
            breaker.onSuccess(p.type)
            attemptsDetail.push(`${p.type}:${label}(ok:${items.length})`)
            return { items, provider: p.type, url: req.url, raw: json }
          }
          recordEmpty(p.type)
          attemptsDetail.push(`${p.type}:${label}(empty)`)
          return null
        } catch (err: any) {
          const msg = String(err?.message || '')
          const status = err?.status || (msg.match(/\b(\d{3})\b/)?.[1] ?? '')
          breaker.onFailure(p.type, Number(status))
          if (String(status) === '422') {
            attemptsDetail.push(`${p.type}:${label}(422)`)
            return null
          }
          attemptsDetail.push(`${p.type}:${label}(err)`)
          errorDetails.push(`${p.type}:${label}: ${msg || 'error'}`)
          throw err
        }
      }

      for (const v of variants) {
        const res = await runVariant(v.label, v.o)
        if (res) return { ...res, attempts, attemptsDetail }
      }
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
        attemptsDetail.push(`${p.type}(err)`)
      }
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
