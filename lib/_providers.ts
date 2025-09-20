import { recordSuccess, recordError, recordEmpty } from './_stats.js'
import { isCoolingDown, setCooldown } from './_cooldown.js'
import { getGnewsApiKey, getGnewsDailyLimit, getGnewsCallCost } from './_env.js'
import { canSpend, spend } from './_budget.js'
import * as breaker from './_breaker.js'

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export function getProvidersForPK() {
  const list: Array<{ type: string; key: string }> = []
  const gnews = getGnewsApiKey()
  if (gnews) list.push({ type: 'gnews', key: gnews })
  return list
}

// For Pakistan top/category endpoints we use GNews provider.
export function getProvidersForPKTop() {
  const list: Array<{ type: string; key: string }> = []
  const gnews = getGnewsApiKey()
  if (gnews) list.push({ type: 'gnews', key: gnews })
  return list
}

export function getProvidersForWorld() {
  const list: Array<{ type: string; key: string }> = []
  const gnews = getGnewsApiKey()
  if (gnews) list.push({ type: 'gnews', key: gnews })
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

  if (p.type === 'gnews') {
    const params = new URLSearchParams()
    params.set('lang', String(opts.language || 'en'))
    params.set('token', p.key)
    const pageNum = clamp(parseInt(String(opts.page || '1'), 10) || 1, 1, 100000)
    params.set('page', String(pageNum))
    params.set('max', '10')
    if (opts.q) params.set('q', String(opts.q))
    // Country mapping: GNews uses country codes e.g., us, pk; if provided, set it
    if (opts.country && /^[a-z]{2}$/i.test(String(opts.country))) {
      params.set('country', String(opts.country).toLowerCase())
    }

    if (intent === 'search') {
      // GNews Search API
      // Docs: https://gnews.io/docs/v4#search
      const url = `https://gnews.io/api/v4/search?${params.toString()}`
      const pick = (d: any) => d?.articles || d?.posts || d?.results || []
      return { url, headers: {}, pick }
    }
    // Default: top-headlines
    // Docs: https://gnews.io/docs/v4#top-headlines
    // Map category to topic where possible
    const category: string | undefined = opts.category
      ? String(opts.category).toLowerCase()
      : undefined
    // Allowed topics: world, nation, business, technology, entertainment, sports, science, health
    const topicAlias: Record<string, string> = {
      general: 'world',
      world: 'world',
      business: 'business',
      technology: 'technology',
      tech: 'technology',
      entertainment: 'entertainment',
      sports: 'sports',
      science: 'science',
      health: 'health',
      politics: 'nation',
    }
    if (category) {
      const topic = topicAlias[category]
      if (topic) params.set('topic', topic)
    }
    const url = `https://gnews.io/api/v4/top-headlines?${params.toString()}`
    const pick = (d: any) => d?.articles || d?.posts || d?.results || []
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
    const err: any = new Error('No providers configured (GNEWS_API missing)')
    err.hint = 'Set GNEWS_API in your environment (Vercel env or local .env)'
    throw err
  }
  // Use providers as supplied by getProviders*
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
      // Circuit breaker skip
      if (!breaker.allowRequest(p.type)) {
        attemptsDetail.push(`${p.type}(breaker-open)`)
        continue
      }
      // Budget gating for GNews
      if (p.type === 'gnews') {
        const limit = getGnewsDailyLimit()
        const cost = getGnewsCallCost()
        const gate = canSpend('gnews', limit, cost)
        if (!gate.ok) {
          attemptsDetail.push(`gnews(skipped:${gate.reason})`)
          continue
        }
      }
      const variants: Array<{ label: string; o: any }> = []
      const pinQ = Boolean((opts as any)?.pinQ)
      if (p.type === 'gnews') {
        // GNews does not support domains/sources filters; keep it simple
        variants.push({ label: 'as-is', o: { ...opts, domains: [], sources: [] } })
        if (!pinQ)
          variants.push({ label: 'no-q', o: { ...opts, q: undefined, domains: [], sources: [] } })
        // Try without country to allow global coverage (useful for PK about scope)
        variants.push({
          label: 'no-country',
          o: { ...opts, country: undefined, domains: [], sources: [] },
        })
        if (!pinQ)
          variants.push({
            label: 'no-country-no-q',
            o: { ...opts, country: undefined, q: undefined, domains: [], sources: [] },
          })
        variants.push({
          label: 'topic-only',
          o: { ...opts, q: undefined, domains: [], sources: [], page: 1 },
        })
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
          // spend budget for GNews on each outward call
          if (p.type === 'gnews') {
            spend('gnews', getGnewsCallCost())
          }
          let items = req.pick(json)
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
