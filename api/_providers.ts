import { recordSuccess, recordError, recordEmpty } from './_stats.js'
import { isCoolingDown, setCooldown } from './_cooldown.js'
import { getNewsDataApiKey } from './_env.js'

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export function getProvidersForPK() {
  const list: Array<{ type: string; key: string }> = []
  // NewsData.io supports country and sources directly
  const key = getNewsDataApiKey()
  if (key) list.push({ type: 'newsdata', key })
  return list
}

export function getProvidersForWorld() {
  const list: Array<{ type: string; key: string }> = []
  const key = getNewsDataApiKey()
  if (key) list.push({ type: 'newsdata', key })
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
    const params = new URLSearchParams({
      apikey: p.key,
      page: String(page),
      page_size: String(pageSizeUsed),
      language: 'en',
    })
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
  if (!providers.length) {
    const keyPresent = Boolean(getNewsDataApiKey())
    const hint = keyPresent
      ? 'NEWSDATA_API present but provider build failed'
      : 'Missing NEWSDATA_API. Set it in Vercel env or a local .env file.'
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
      // Build attempt variants for NewsData to reduce 422/empty cases
      const variants: Array<{ label: string; o: any }> = []
      if (p.type === 'newsdata') {
        variants.push({ label: 'as-is', o: { ...opts } })
        variants.push({ label: 'no-category', o: { ...opts, category: undefined } })
        variants.push({ label: 'no-domains-sources', o: { ...opts, domains: [], sources: [] } })
        variants.push({ label: 'no-q', o: { ...opts, q: undefined } })
        variants.push({ label: 'no-country', o: { ...opts, country: undefined } })
        variants.push({
          label: 'minimal',
          o: { page: opts.page, pageSize: opts.pageSize, country: opts.country },
        })
      } else {
        variants.push({ label: 'as-is', o: { ...opts } })
      }

      const runVariant = async (label: string, o: any) => {
        const req = buildProviderRequest(p, intent, o)
        if (!req) throw new Error('Unsupported request for provider')
        try {
          const json = await fetcher(req.url, req.headers)
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
          const items = req.pick(json)
          if (Array.isArray(items) && items.length) {
            recordSuccess(p.type, items.length)
            attemptsDetail.push(`${p.type}:${label}(ok:${items.length})`)
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
          throw err
        }
      }

      for (const v of variants) {
        const res = await runVariant(v.label, v.o)
        if (res) return { ...res, attempts, attemptsDetail }
      }
      // All variants returned empty
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
