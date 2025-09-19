import { cors } from './_shared.js'
import { withHttpMetrics } from './_httpMetrics.js'

async function handler(req: any, res: any) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  try {
    const token = process.env.METRICS_API_TOKEN
    if (token) {
      const auth = String(req.headers.authorization || '')
      if (auth !== `Bearer ${token}`) return res.status(401).json({ error: 'unauthorized' })
    }
    const cacheMod: any = await import('./_cache.js')
    const revalMod: any = await import('./_revalidate.js').catch(() => ({}))
    const adaptiveMod: any = await import('./_adaptive.js').catch(() => ({}))
    const breakerMod: any = await import('./_breaker.js').catch(() => ({}))
    const budgetMod: any = await import('./_budget.js').catch(() => ({}))
    const stats = cacheMod.cacheStats?.()
    const reval = revalMod.bgRevalStats ? revalMod.bgRevalStats() : null
    const prefetchMod: any = await import('./_prefetch.js').catch(() => ({}))
    const prefetch = prefetchMod.prefetchStats ? prefetchMod.prefetchStats() : null
    const adaptive = adaptiveMod.adaptiveStats ? adaptiveMod.adaptiveStats(20) : null
    const breaker = breakerMod.getBreakerSnapshot ? breakerMod.getBreakerSnapshot() : null
    const budget = budgetMod.getBudgetSnapshot ? budgetMod.getBudgetSnapshot() : null
    res.setHeader('Cache-Control', 'no-store')
    const ok = stats?.metricsPushOk || 0
    const fail = stats?.metricsPushFail || 0
    const total = ok + fail
    const successRatio = total ? Number((ok / total).toFixed(4)) : 0
    return res.status(200).json({
      cache: stats,
      revalidation: reval,
      prefetch,
      adaptive,
      breaker,
      budget,
      push: stats
        ? {
            ok,
            fail,
            successRatio,
          }
        : null,
    })
  } catch (e: any) {
    return res.status(500).json({ error: 'metrics-failed', message: e?.message || String(e) })
  }
}

export default withHttpMetrics(handler)
