import { normalize } from '../_normalize.js'
import { cors, cache, upstreamJson } from '../_shared.js'

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  const { slug } = req.query
  try {
    // NewsAPI.org by category
    const allowed = [
      'business',
      'entertainment',
      'general',
      'health',
      'science',
      'sports',
      'technology',
    ]
    const cat = allowed.includes(String(slug)) ? String(slug) : 'general'
    const url = `https://newsapi.org/v2/top-headlines?country=pk&category=${encodeURIComponent(
      cat
    )}&pageSize=50`
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
