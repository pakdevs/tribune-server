export function cors(res: any) {
  const allow = (process as any)?.env?.ALLOW_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', allow)
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader(
    'Permissions-Policy',
    [
      'geolocation=()',
      'camera=()',
      'microphone=()',
      'payment=()',
      'accelerometer=()',
      'gyroscope=()',
      'magnetometer=()',
    ].join(', ')
  )
}

export function cache(res: any, seconds = 300, swr = 60) {
  const envFresh = parseInt(String((process as any)?.env?.CACHE_FRESH_TTL || ''), 10)
  const envStaleExtra = parseInt(String((process as any)?.env?.CACHE_STALE_EXTRA || ''), 10)
  const fresh = Number.isFinite(envFresh) ? Math.min(1800, Math.max(5, envFresh)) : seconds
  const swrTotal = Number.isFinite(envStaleExtra) ? Math.min(7200, Math.max(0, envStaleExtra)) : swr
  // Use s-maxage for CDN, and let browser honor revalidation separately (could add max-age if desired)
  res.setHeader('Cache-Control', `public, s-maxage=${fresh}, stale-while-revalidate=${swrTotal}`)
}

// Attach debug cache metrics (lightweight) when requested
export async function addCacheDebugHeaders(res: any, req?: any) {
  try {
    if (!req) return
    if (String(req.query?.debug) !== '1') return
    const mod: any = await import('./_cache.js')
    const stats = mod.cacheStats?.()
    if (!stats) return
    res.setHeader('X-Cache-Hits-Fresh', String(stats.hitsFresh))
    res.setHeader('X-Cache-Hits-Stale', String(stats.hitsStale))
    res.setHeader('X-Cache-Misses', String(stats.misses))
    res.setHeader('X-Cache-Negative-Hits', String(stats.negativeHits))
    res.setHeader('X-Cache-Negative-Puts', String(stats.negativePuts))
    res.setHeader('X-Cache-Evict-LRU', String(stats.evictionsLRU))
    res.setHeader('X-Cache-Evict-Expired', String(stats.evictionsExpired))
    res.setHeader('X-Cache-Size', String(stats.size))
    res.setHeader('X-Cache-Capacity', String(stats.capacity))
    res.setHeader('X-Cache-Hit-Ratio', stats.hitRatio.toFixed(4))
    res.setHeader('X-Cache-Fresh-Ratio', stats.freshRatio.toFixed(4))
    res.setHeader('X-Cache-Stale-Ratio', stats.staleRatio.toFixed(4))
    if (typeof stats.l2Hits === 'number') {
      const l2Total = (stats.l2Hits || 0) + (stats.l2Misses || 0)
      const l2HitRatio = l2Total ? stats.l2Hits / l2Total : 0
      res.setHeader('X-L2-Hits', String(stats.l2Hits))
      res.setHeader('X-L2-Misses', String(stats.l2Misses || 0))
      res.setHeader('X-L2-Writes', String(stats.l2Writes || 0))
      res.setHeader('X-L2-Promotions', String(stats.l2Promotions || 0))
      res.setHeader('X-L2-Hit-Ratio', l2HitRatio.toFixed(4))
    }
    // Background revalidation metrics (optional best-effort import)
    try {
      const rmod: any = await import('./_revalidate.js')
      if (rmod.bgRevalStats) {
        const rstats = rmod.bgRevalStats()
        res.setHeader('X-Reval-Scheduled', String(rstats.scheduled))
        res.setHeader('X-Reval-Success', String(rstats.success))
        res.setHeader('X-Reval-Fail', String(rstats.fail))
        res.setHeader('X-Reval-Inflight', String(rstats.inflight))
        res.setHeader('X-Reval-Skipped-Fresh', String(rstats.skippedFresh))
        res.setHeader('X-Reval-Skipped-Recent', String(rstats.skippedRecent))
        res.setHeader('X-Reval-Skipped-Inflight', String(rstats.skippedInflight))
        res.setHeader('X-Reval-Skipped-MaxConc', String(rstats.skippedMaxConcurrent))
        res.setHeader('X-Reval-Skipped-Negative', String(rstats.skippedNegative))
        // Adaptive classification counters (if adaptive module active)
        if (typeof rstats.adaptiveHot === 'number') {
          res.setHeader('X-Reval-Adaptive-Hot', String(rstats.adaptiveHot))
          res.setHeader('X-Reval-Adaptive-Cold', String(rstats.adaptiveCold))
          res.setHeader('X-Reval-Adaptive-Baseline', String(rstats.adaptiveBaseline))
          res.setHeader('X-Reval-Adaptive-Suppressed', String(rstats.adaptiveSuppressed))
        }
      }
      // Prefetch stats (Phase 5)
      try {
        const pmod: any = await import('./_prefetch.js')
        if (pmod.prefetchStats) {
          const p = pmod.prefetchStats()
          res.setHeader('X-Prefetch-Scheduled', String(p.prefetchScheduled))
          res.setHeader('X-Prefetch-Success', String(p.prefetchSuccess))
          res.setHeader('X-Prefetch-Fail', String(p.prefetchFail))
          res.setHeader('X-Prefetch-Registry', String(p.registrySize))
          res.setHeader('X-Prefetch-Skipped-Disabled', String(p.prefetchSkippedDisabled))
          res.setHeader('X-Prefetch-Skipped-Suspended', String(p.prefetchSkippedSuspended))
          res.setHeader('X-Prefetch-Skipped-Cooldown', String(p.prefetchSkippedCooldown))
          res.setHeader('X-Prefetch-Skipped-NoHot', String(p.prefetchSkippedNoHot))
          res.setHeader('X-Prefetch-Skipped-Throttled', String(p.prefetchSkippedThrottled))
        }
      } catch {}
    } catch {}

    // Entity headers exposure (if response already has them set earlier in flow)
    try {
      const etag = res.getHeader && res.getHeader('ETag')
      const lm = res.getHeader && res.getHeader('Last-Modified')
      if (etag) res.setHeader('X-Entity-ETag', String(etag))
      if (lm) res.setHeader('X-Entity-LastModified', String(lm))
      const mode = String(process.env.ETAG_MODE || 'weak')
      res.setHeader('X-Entity-ETag-Mode', mode)
    } catch {}
  } catch {}
}

export async function upstreamJson(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 8000
) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  try {
    const r = await fetch(url, { headers, signal: controller.signal })
    const latency = Date.now() - started
    try {
      const m = await import('./_metrics.js')
      if (!r.ok) {
        // Differentiate timeout vs error later (timeout path in catch below)
        m.recordUpstream('error', latency)
      } else {
        m.recordUpstream('ok', latency)
      }
    } catch {}
    if (!r.ok) {
      const err: any = new Error(`Upstream ${r.status}`)
      err.status = r.status
      const ra = r.headers.get('retry-after')
      if (ra) err.retryAfter = ra
      throw err
    }
    return r.json()
  } catch (e: any) {
    const latency = Date.now() - started
    if (e?.name === 'AbortError') {
      try {
        const m = await import('./_metrics.js')
        m.recordUpstream('timeout', latency)
      } catch {}
      const err: any = new Error('Upstream timeout')
      err.status = 504
      throw err
    }
    throw e
  } finally {
    clearTimeout(timeoutId)
  }
}
