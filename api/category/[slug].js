import { normalize } from '../_normalize.js'
import { cors, cache, upstreamJson } from '../_shared.js'

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  const { slug } = req.query
  try {
  // NewsAPI.org by category (US default). Case-insensitive, with aliasing and pagination.
  const country = String(req.query.country || 'us')
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
  const rawPageSize = parseInt(String(req.query.pageSize || req.query.limit || '50'), 10)
  const pageSize = Math.min(100, Math.max(1, rawPageSize || 50))

  const raw = String(slug || '').toLowerCase()
  const alias = { politics: 'general', world: 'general', tech: 'technology', sci: 'science', biz: 'business' }
  const allowed = new Set(['business', 'entertainment', 'general', 'health', 'science', 'sports', 'technology'])
  const mapped = raw ? alias[raw] || raw : 'general'
  const category = allowed.has(mapped) ? mapped : 'general'

  const params = new URLSearchParams({ country, category, page: String(page), pageSize: String(pageSize) })
  const url = `https://newsapi.org/v2/top-headlines?${params.toString()}`
  const data = await upstreamJson(url, { 'X-Api-Key': process.env.NEWSAPI_ORG || '' })
    const items = Array.isArray(data?.articles)
      ? data.articles
      : Array.isArray(data?.items)
      ? data.items
      : []
    const normalized = items.map(normalize).filter(Boolean)
    cache(res, 300, 60)
    if (!normalized.length && String(req.query.debug) === '1') {
      return res.status(200).json({
        items: [],
        debug: {
          upstreamStatus: data?.status ?? null,
          totalResults: data?.totalResults ?? null,
          message: data?.message ?? null,
          url,
          slug: raw,
          category,
          country,
          page,
          pageSize,
          hasKey: Boolean(process.env.NEWSAPI_ORG),
        },
      })
    }
    return res.status(200).json({ items: normalized })
  } catch (e) {
    return res.status(500).json({ error: 'Proxy failed' })
  }
}
