import { normalize } from './_normalize.js'
import { cors, cache, upstreamJson } from './_shared.js'

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  try {
    // NewsAPI.org Top Headlines (defaults to US). You can override via query params.
    const country = String(req.query.country || 'us')

    // Pagination
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const rawPageSize = parseInt(String(req.query.pageSize || req.query.limit || '50'), 10)
    const pageSize = Math.min(100, Math.max(1, rawPageSize || 50))

    // Category aliasing (optional). "all" or unsupported => omit.
    const rawCategory = req.query.category ? String(req.query.category).toLowerCase() : undefined
    const alias = {
      politics: 'general',
      world: 'general',
      tech: 'technology',
      sci: 'science',
      biz: 'business',
    }
    const allowed = new Set([
      'business',
      'entertainment',
      'general',
      'health',
      'science',
      'sports',
      'technology',
    ])
    const mapped = rawCategory ? alias[rawCategory] || rawCategory : undefined
    const category = mapped && mapped !== 'all' && allowed.has(mapped) ? mapped : undefined

    const params = new URLSearchParams({ country, page: String(page), pageSize: String(pageSize) })
    if (category) params.set('category', category)
    const url = `https://newsapi.org/v2/top-headlines?${params.toString()}`
    const data = await upstreamJson(url, {
      'X-Api-Key': process.env.NEWSAPI_ORG || '',
    })
    const items = Array.isArray(data?.articles)
      ? data.articles
      : Array.isArray(data?.items)
      ? data.items
      : []
    const normalized = items.map(normalize).filter(Boolean)
    // Optional debug: add ?debug=1 to see upstream status when empty
  if (!normalized.length && String(req.query.debug) === '1') {
      return res.status(200).json({
        items: [],
        debug: {
          upstreamStatus: data?.status ?? null,
          totalResults: data?.totalResults ?? null,
          message: data?.message ?? null,
          url,
          country,
      category: category || null,
      page,
      pageSize,
          hasKey: Boolean(process.env.NEWSAPI_ORG),
        },
      })
    }
    cache(res, 300, 60)
    return res.status(200).json({ items: normalized })
  } catch (e) {
    return res.status(500).json({ error: 'Proxy failed' })
  }
}
