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
const DEFAULT_NEWSAPI_BASE = DEFAULT_NEWSAPI_ENDPOINT.replace(/\/[^/]+$/, '')
const NEWSAPI_BASE = (() => {
  const override = (process as any)?.env?.NEWSAPI_AI_BASE
  if (override) return String(override).replace(/\/$/, '')
  const idx = NEWSAPI_ENDPOINT.lastIndexOf('/')
  if (idx <= 'https://'.length) return DEFAULT_NEWSAPI_BASE
  return NEWSAPI_ENDPOINT.slice(0, idx)
})()

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

const ISO2_TO_ISO3: Record<string, string> = {
  en: 'eng',
  ar: 'ara',
  bn: 'ben',
  de: 'deu',
  es: 'spa',
  fr: 'fra',
  hi: 'hin',
  id: 'ind',
  it: 'ita',
  ja: 'jpn',
  ko: 'kor',
  ms: 'msa',
  pt: 'por',
  ru: 'rus',
  tr: 'tur',
  ur: 'urd',
  zh: 'zho',
}

const COUNTRY_TO_LOCATION_URI: Record<string, string> = {
  ae: 'http://en.wikipedia.org/wiki/United_Arab_Emirates',
  au: 'http://en.wikipedia.org/wiki/Australia',
  ca: 'http://en.wikipedia.org/wiki/Canada',
  cn: 'http://en.wikipedia.org/wiki/China',
  de: 'http://en.wikipedia.org/wiki/Germany',
  gb: 'http://en.wikipedia.org/wiki/United_Kingdom',
  in: 'http://en.wikipedia.org/wiki/India',
  jp: 'http://en.wikipedia.org/wiki/Japan',
  my: 'http://en.wikipedia.org/wiki/Malaysia',
  pk: 'http://en.wikipedia.org/wiki/Pakistan',
  sa: 'http://en.wikipedia.org/wiki/Saudi_Arabia',
  sg: 'http://en.wikipedia.org/wiki/Singapore',
  us: 'http://en.wikipedia.org/wiki/United_States',
}

function normalizeLanguage(lang: any, fallback = 'eng') {
  const value = String(lang || '')
    .trim()
    .toLowerCase()
  if (!value) return fallback
  if (ISO2_TO_ISO3[value]) return ISO2_TO_ISO3[value]
  if (/^[a-z]{3}$/.test(value)) return value
  return fallback
}

function mapCountryToLocationUri(country?: string) {
  if (!country) return undefined
  const normalized = country.trim().toLowerCase()
  if (!normalized) return undefined
  return COUNTRY_TO_LOCATION_URI[normalized]
}

function stripUndefined(obj: Record<string, any>) {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) delete obj[key]
  }
  return obj
}

const pickArticles = (d: any) => {
  if (!d) return []
  if (Array.isArray(d.articles)) return d.articles
  if (Array.isArray(d.results)) return d.results
  if (Array.isArray(d?.articles?.results)) return d.articles.results
  if (Array.isArray(d?.data?.articles)) return d.data.articles
  return []
}

function resolveNewsApiEndpoint(path: string) {
  if (!path || path === 'getArticles') return NEWSAPI_ENDPOINT
  const normalized = path.replace(/^\/+/, '')
  return `${NEWSAPI_BASE}/${normalized}`
}

function buildArticlesEndpointRequest(
  provider: ProviderConfig,
  path: string,
  payload: Record<string, any>,
  pickOverride?: (data: any) => any[]
): ProviderRequest {
  const body = { apiKey: provider.key, ...stripUndefined(payload) }
  return {
    url: resolveNewsApiEndpoint(path),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    pick: pickOverride || pickArticles,
  }
}

// Reference docs:
//  - https://newsapi.ai/documentation?tab=searchArticles
//  - https://newsapi.ai/documentation?tab=searchArticlesForTopic
//  - https://newsapi.ai/documentation?tab=articleDetails
//  - https://newsapi.ai/documentation?tab=feedOfArticles
function buildNewsApiAiRequest(
  provider: ProviderConfig,
  intent: 'top' | 'search',
  opts: any
): ProviderRequest {
  const page = clamp(parseInt(String(opts.page || '1'), 10) || 1, 1, 100000)
  const pageSize = clamp(parseInt(String(opts.pageSize || '10'), 10) || 10, 1, 100)
  const language = normalizeLanguage(opts.language, 'eng')
  const countryUri = mapCountryToLocationUri(opts.country)
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
  if (intent === 'top' && !q && countryUri) {
    queryClauses.push({ locationUri: countryUri })
  }
  if (!queryClauses.length) {
    queryClauses.push({ keyword: 'news', keywordLoc: 'title' })
  }

  const filter: Record<string, any> = {
    lang: [language],
  }
  if (countryUri) {
    filter.sourceLocationUri = [countryUri]
  }

  const sortBy = intent === 'top' ? 'sourceImportance' : 'date'
  const body = {
    query: {
      $query: { $and: queryClauses },
      $filter: filter,
    },
    resultType: 'articles',
    articlesPage: page,
    articlesCount: pageSize,
    articlesSortBy: sortBy,
    articlesSortByAsc: false,
    articleBodyLen: -1,
    includeArticleTitle: true,
    includeArticleBasicInfo: true,
    includeArticleBody: true,
    includeArticleImage: true,
    includeArticleAuthors: true,
    includeArticleConcepts: false,
    includeArticleCategories: false,
    includeArticleLocation: false,
    includeSourceTitle: true,
    includeSourceLocation: false,
    includeSourceRanking: false,
    isDuplicateFilter: 'skipDuplicates',
    dataType: ['news'],
  }

  return buildArticlesEndpointRequest(provider, 'getArticles', body, pickArticles)
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

export interface NewsApiTopicArticlesOptions {
  topicUri: string
  page?: number
  pageSize?: number
  sortBy?:
    | 'date'
    | 'rel'
    | 'sourceImportance'
    | 'sourceImportanceRank'
    | 'sourceAlexaGlobalRank'
    | 'sourceAlexaCountryRank'
  sortByAsc?: boolean
  language?: string
  dataType?: string | string[]
  includeArticleBody?: boolean
  extra?: Record<string, any>
}

export function buildNewsApiArticlesForTopicRequest(
  provider: ProviderConfig,
  opts: NewsApiTopicArticlesOptions
): ProviderRequest {
  if (!opts?.topicUri) throw new Error('topicUri is required for topic article requests')
  const page = clamp(parseInt(String(opts.page ?? '1'), 10) || 1, 1, 100000)
  const count = clamp(parseInt(String(opts.pageSize ?? '10'), 10) || 10, 1, 100)
  const lang = opts.language ? normalizeLanguage(opts.language, 'eng') : undefined
  const payload: Record<string, any> = {
    topicUri: opts.topicUri,
    resultType: 'articles',
    articlesPage: page,
    articlesCount: count,
    articlesSortBy: opts.sortBy || 'date',
    articlesSortByAsc: opts.sortByAsc ?? false,
    articleBodyLen: -1,
    includeArticleTitle: true,
    includeArticleBasicInfo: true,
    includeArticleBody: opts.includeArticleBody !== false,
    includeArticleImage: true,
    includeArticleAuthors: true,
    dataType: opts.dataType || ['news'],
  }
  if (lang) payload.lang = [lang]
  if (opts.extra) Object.assign(payload, stripUndefined({ ...opts.extra }))
  return buildArticlesEndpointRequest(provider, 'getArticlesForTopicPage', payload, pickArticles)
}

export interface NewsApiArticleDetailsOptions {
  articleUri?: string
  articleUrl?: string
  articleId?: string | number
  includeArticleBody?: boolean
  includeArticleImage?: boolean
  includeArticleAuthors?: boolean
  includeArticleConcepts?: boolean
  includeArticleCategories?: boolean
  includeArticleLocation?: boolean
  includeArticleDuplicateList?: boolean
  includeArticleOriginalArticle?: boolean
  extra?: Record<string, any>
}

export function buildNewsApiArticleDetailsRequest(
  provider: ProviderConfig,
  opts: NewsApiArticleDetailsOptions
): ProviderRequest {
  if (!opts.articleUri && !opts.articleUrl && !opts.articleId) {
    throw new Error('Provide articleUri, articleUrl, or articleId for article details request')
  }
  const payload: Record<string, any> = {
    articleUri: opts.articleUri,
    articleUrl: opts.articleUrl,
    articleId: opts.articleId,
    includeArticleTitle: true,
    includeArticleBasicInfo: true,
    includeArticleBody: opts.includeArticleBody !== false,
    includeArticleImage: opts.includeArticleImage !== false,
    includeArticleAuthors: opts.includeArticleAuthors !== false,
    includeArticleConcepts: opts.includeArticleConcepts === true,
    includeArticleCategories: opts.includeArticleCategories === true,
    includeArticleLocation: opts.includeArticleLocation === true,
    includeArticleDuplicateList: opts.includeArticleDuplicateList === true,
    includeArticleOriginalArticle: opts.includeArticleOriginalArticle === true,
  }
  if (opts.extra) Object.assign(payload, stripUndefined({ ...opts.extra }))
  return buildArticlesEndpointRequest(provider, 'getArticle', payload, (data: any) => {
    if (data?.article) return [data.article]
    if (data?.data?.article) return [data.data.article]
    return pickArticles(data)
  })
}

export interface NewsApiFeedOptions {
  page?: number
  pageSize?: number
  sortBy?: 'date' | 'rel' | 'sourceImportance' | 'sourceImportanceRank'
  sortByAsc?: boolean
  language?: string
  query?: Record<string, any>
  filter?: Record<string, any>
  dataType?: string | string[]
  sinceHours?: number
  extra?: Record<string, any>
}

export function buildNewsApiFeedOfArticlesRequest(
  provider: ProviderConfig,
  opts: NewsApiFeedOptions = {}
): ProviderRequest {
  const page = clamp(parseInt(String(opts.page ?? '1'), 10) || 1, 1, 100000)
  const count = clamp(parseInt(String(opts.pageSize ?? '20'), 10) || 20, 1, 100)
  const lang = opts.language ? normalizeLanguage(opts.language, 'eng') : undefined
  const filter = { ...(opts.filter || {}) }
  if (lang) {
    if (Array.isArray(filter.lang))
      filter.lang = filter.lang.map((l: any) => normalizeLanguage(l, 'eng'))
    else filter.lang = [lang]
  }
  const payload: Record<string, any> = {
    resultType: 'recentActivityArticles',
    recentActivityArticlesPage: page,
    recentActivityArticlesCount: count,
    recentActivityArticlesSortBy: opts.sortBy || 'date',
    recentActivityArticlesSortByAsc: opts.sortByAsc ?? false,
    dataType: opts.dataType || ['news'],
  }
  if (opts.query) {
    payload.query = opts.query
  } else if (Object.keys(filter).length) {
    payload.query = { $filter: filter }
  }
  if (opts.sinceHours !== undefined) {
    const since = clamp(parseInt(String(opts.sinceHours), 10) || 0, 0, 720)
    payload.sinceHours = since
  }
  if (opts.extra) Object.assign(payload, stripUndefined({ ...opts.extra }))
  return buildArticlesEndpointRequest(provider, 'getArticles', payload, (data: any) => {
    if (Array.isArray(data?.recentActivityArticles)) return data.recentActivityArticles
    if (Array.isArray(data?.recentActivityArticles?.results))
      return data.recentActivityArticles.results
    return pickArticles(data)
  })
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
