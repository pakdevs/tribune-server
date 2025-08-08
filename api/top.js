import { normalize } from './_normalize.js'
import { cors, cache, upstreamJson } from './_shared.js'

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  try {
    // TODO: replace with your real upstream(s)
    // Example: NewsCatcher/Bing/RSS aggregator endpoint you control
    const data = await upstreamJson('https://example.com/upstream/top', {
      'x-api-key': process.env.NEWS_API_KEY || '',
    })
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
