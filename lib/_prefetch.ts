// Phase 5: Adaptive Prefetch & Warming
// Proactively refresh hottest keys shortly before they become eligible for normal background revalidation
// Uses registry of fetchers (captured from background revalidation) and adaptive hot sample.

interface PrefetchConfig {
  enabled: boolean
  freshThresholdMs: number // remaining fresh time below which we prefetch
  maxBatch: number
  minIntervalMs: number // per-key throttle (successful prefetch)
  globalCooldownMs: number // minimum ms between ticks
  errorBurst: number // suspend if too many fails in recent window
  suspendMs: number // suspension duration after burst
}

const cfg: PrefetchConfig = {
  enabled: String(process.env.PREFETCH_ENABLED || '1') === '1',
  freshThresholdMs: clampInt(process.env.PREFETCH_FRESH_THRESHOLD_MS, 500, 120000, 4000),
  maxBatch: clampInt(process.env.PREFETCH_MAX_BATCH, 1, 10, 3),
  minIntervalMs: clampInt(process.env.PREFETCH_MIN_INTERVAL_MS, 1000, 600000, 20000),
  globalCooldownMs: clampInt(process.env.PREFETCH_GLOBAL_COOLDOWN_MS, 1000, 600000, 30000),
  errorBurst: clampInt(process.env.PREFETCH_ERROR_BURST, 1, 50, 3),
  suspendMs: clampInt(process.env.PREFETCH_SUSPEND_MS, 1000, 3600000, 120000),
}

function clampInt(v: any, min: number, max: number, d: number) {
  const n = parseInt(String(v || ''), 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d
}

type FetcherResult = { items: any[]; meta: any }
type FetcherFn = () => Promise<FetcherResult>

// Registry: key -> fetcher
const registry = new Map<string, FetcherFn>()
const lastPrefetchSuccess = new Map<string, number>()
const recentErrors: number[] = [] // timestamps
let suspendedUntil = 0
let lastTick = 0

const metrics = {
  prefetchScheduled: 0,
  prefetchSuccess: 0,
  prefetchFail: 0,
  prefetchSkippedDisabled: 0,
  prefetchSkippedSuspended: 0,
  prefetchSkippedCooldown: 0,
  prefetchSkippedNoHot: 0,
  prefetchSkippedThrottled: 0,
}

export function registerFetcher(key: string, fn: FetcherFn) {
  if (!cfg.enabled) return
  registry.set(key, fn)
}

// Called opportunistically (e.g., from cache metrics logging) to run a tiny prefetch batch.
export async function prefetchTick() {
  if (!cfg.enabled) {
    metrics.prefetchSkippedDisabled++
    return
  }
  const now = Date.now()
  if (now < suspendedUntil) {
    metrics.prefetchSkippedSuspended++
    return
  }
  if (now - lastTick < cfg.globalCooldownMs) {
    metrics.prefetchSkippedCooldown++
    return
  }
  lastTick = now
  // Import adaptive hot sample best-effort
  let hot: Array<{ key: string; emaHPM: number }> = []
  try {
    const mod: any = await import('./_adaptive.js')
    if (mod.adaptiveStats) {
      const stats = mod.adaptiveStats(10)
      if (stats?.hotSample) hot = stats.hotSample
    }
  } catch {}
  if (!hot.length) {
    metrics.prefetchSkippedNoHot++
    return
  }
  // Evaluate each hot key for prefetch conditions
  const selected: string[] = []
  for (const h of hot) {
    if (selected.length >= cfg.maxBatch) break
    const key = h.key
    if (!registry.has(key)) continue
    // Check cache state
    try {
      const cache: any = await import('./_cache.js')
      const info = cache.cacheInfo?.(key)
      if (!info) continue
      if (info.freshForMs > cfg.freshThresholdMs) continue // still plenty of fresh time
      const last = lastPrefetchSuccess.get(key) || 0
      if (now - last < cfg.minIntervalMs) {
        metrics.prefetchSkippedThrottled++
        continue
      }
      selected.push(key)
    } catch {}
  }
  if (!selected.length) return
  for (const key of selected) {
    const fn = registry.get(key)
    if (!fn) continue
    metrics.prefetchScheduled++
    ;(async () => {
      try {
        const result = await fn()
        if (result && Array.isArray(result.items)) {
          const cache: any = await import('./_cache.js')
          cache.setCache?.(key, result)
          lastPrefetchSuccess.set(key, Date.now())
          metrics.prefetchSuccess++
          console.log(
            JSON.stringify({
              level: 'info',
              msg: 'prefetch-success',
              key,
              count: result.items.length,
            })
          )
        }
      } catch (e: any) {
        metrics.prefetchFail++
        recentErrors.push(Date.now())
        console.log(
          JSON.stringify({
            level: 'warn',
            msg: 'prefetch-fail',
            key,
            error: e?.message || String(e),
          })
        )
        // Trim error window to last 2 minutes
        const cutoff = Date.now() - 120000
        while (recentErrors.length && recentErrors[0] < cutoff) recentErrors.shift()
        if (recentErrors.length >= cfg.errorBurst) {
          suspendedUntil = Date.now() + cfg.suspendMs
          console.log(
            JSON.stringify({
              level: 'warn',
              msg: 'prefetch-suspended',
              until: new Date(suspendedUntil).toISOString(),
              recentErrors: recentErrors.length,
            })
          )
        }
      }
    })().catch(() => {})
  }
}

export function prefetchStats() {
  return { ...metrics, registrySize: registry.size, suspendedUntil }
}

export function __resetPrefetch() {
  for (const k of Object.keys(metrics)) (metrics as any)[k] = 0
  registry.clear()
  lastPrefetchSuccess.clear()
  recentErrors.length = 0
  suspendedUntil = 0
  lastTick = 0
}
