import { normalize } from './_normalize.js'
import { cors, cache, upstreamJson } from './_shared.js'

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  const q = String(req.query.q || '').trim()
  const category = String(req.query.category || 'all')
  if (!q) return res.status(200).json({ items: [] })
  try {
    // NewsAPI.org Everything endpoint (search)
    // Note: category isn't directly supported on /everything; keep simple text search.
    const params = new URLSearchParams({
      q,
      language: 'en',
      sortBy: 'publishedAt',
      pageSize: '50',
    })
    const url = `https://newsapi.org/v2/everything?${params.toString()}`
    const data = await upstreamJson(url, { 'X-Api-Key': process.env.NEWSAPI_ORG || '' })
    const items = Array.isArray(data?.articles)
      ? data.articles
      : Array.isArray(data?.items)
      ? data.items
      : []
    const normalized = items.map(normalize).filter(Boolean)
    cache(res, 300, 60)
    return res.status(200).json({ items: normalized })
  } catch (e) {
    return res.status(500).json({ error: 'Proxy failed' })
  }
}
