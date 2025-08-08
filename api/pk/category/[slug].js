import { normalize } from '../../_normalize.js'
import { cors, cache, upstreamJson } from '../../_shared.js'
import { getProvidersForPK, tryProvidersSequential } from '../../_providers.js'

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  const rawSlug = String(req.query.slug || '').toLowerCase()
  const alias = { politics: 'general', world: 'general', tech: 'technology', sci: 'science', biz: 'business' }
  const allowed = new Set(['business', 'entertainment', 'general', 'health', 'science', 'sports', 'technology'])
  const mapped = rawSlug ? alias[rawSlug] || rawSlug : 'general'
  const category = allowed.has(mapped) ? mapped : 'general'

  const page = String(req.query.page || '1')
  const pageSize = String(req.query.pageSize || req.query.limit || '50')
  const country = 'pk'
  try {
    const providers = getProvidersForPK()
    const result = await tryProvidersSequential(
      providers,
      'top',
      { page, pageSize, country, category },
      (url, headers) => upstreamJson(url, headers)
    )
    const normalized = result.items.map(normalize).filter(Boolean)
    cache(res, 300, 60)
    if (!normalized.length && String(req.query.debug) === '1') {
      return res.status(200).json({ items: [], debug: { provider: result.provider, url: result.url, category } })
    }
    return res.status(200).json({ items: normalized })
  } catch (e) {
    if (String(req.query.debug) === '1') {
      return res.status(500).json({ error: 'Proxy failed', message: e?.message || String(e) })
    }
    return res.status(500).json({ error: 'Proxy failed' })
  }
}
