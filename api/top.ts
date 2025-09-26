import { normalize } from './_normalize.js'
import { cors, cache, upstreamJson, addCacheDebugHeaders } from './_shared.js'
import { getFresh, getStale, setCache, getFreshOrL2 } from './_cache.js'
import { maybeScheduleRevalidate } from './_revalidate.js'
import { buildCacheKey } from './_key.js'
import { getProvidersForWorld, tryProvidersSequential } from './_providers.js'
import { getInFlight, setInFlight } from './_inflight.js'

const alias: Record<string, string> = {
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

async function handler(req: any, res: any) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  // Minimal rate limiting: 60 req / 60s per IP
  res.statusCode = 410
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  return res.end(JSON.stringify({ error: 'Gone', message: 'Use /api/world instead' }))
}

export default handler
