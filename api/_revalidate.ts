import { getAny, setCache, cacheInfo, getFresh } from './_cache.js'
// Lazy adaptive import to avoid coupling at init
let __computeAdaptive: null | ((base: number, key: string) => any) = null
// eslint-disable-next-line @typescript-eslint/no-floating-promises
import('./_adaptive.js')
  .then((m: any) => {
    if (typeof m.computeAdaptiveThreshold === 'function')
      __computeAdaptive = m.computeAdaptiveThreshold
  })
  .catch(() => {})
import { buildCacheKey } from './_key.js'
// Lazy prefetch import
let __registerPrefetch: null | ((key: string, fn: any) => void) = null
// eslint-disable-next-line @typescript-eslint/no-floating-promises
import('./_prefetch.js')
  .then((m: any) => {
    if (typeof m.registerFetcher === 'function') __registerPrefetch = m.registerFetcher
  })
  .catch(() => {})

/**
 * Lightweight opportunistic background revalidation (Phase 4 scaffold).
 * Strategy:
 *  - Called inline after serving a response (fresh or stale) when near expiry.
 *  - Uses a per-key in-flight map to prevent duplicate refreshes.
 *  - Caps concurrent background refreshes.
 *  - Skips if negative or already very recently refreshed.
 * Env Controls:
 *  ENABLE_BG_REVALIDATE=1 to enable.
 *  BG_REVALIDATE_FRESH_THRESHOLD_MS (default 15_000): if remaining fresh time < threshold, schedule.
 *  BG_MAX_INFLIGHT (default 3): concurrent background revalidations.
 *  BG_MIN_INTERVAL_MS (default 10_000): minimum elapsed ms between successful refreshes per key.
 */

const ENABLED = String(process.env.ENABLE_BG_REVALIDATE || '1') === '1'
const FRESH_THRESHOLD = parseInt(String(process.env.BG_REVALIDATE_FRESH_THRESHOLD_MS || ''), 10)
const FRESH_THRESHOLD_MS = Number.isFinite(FRESH_THRESHOLD)
  ? Math.max(1000, FRESH_THRESHOLD)
  : 15_000
const MAX_INFLIGHT_ENV = parseInt(String(process.env.BG_MAX_INFLIGHT || ''), 10)
const MAX_INFLIGHT = Number.isFinite(MAX_INFLIGHT_ENV)
  ? Math.min(10, Math.max(1, MAX_INFLIGHT_ENV))
  : 3
const MIN_INTERVAL_ENV = parseInt(String(process.env.BG_MIN_INTERVAL_MS || ''), 10)
const MIN_INTERVAL_MS = Number.isFinite(MIN_INTERVAL_ENV)
  ? Math.max(1000, MIN_INTERVAL_ENV)
  : 10_000

const inflight = new Map<string, Promise<any>>()
const lastSuccess = new Map<string, number>()

let currentActive = 0

// Metrics (lightweight, in-memory)
const metrics = {
  scheduled: 0,
  skippedFresh: 0,
  skippedRecent: 0,
  skippedInflight: 0,
  skippedMaxConcurrent: 0,
  skippedMissing: 0,
  skippedNegative: 0,
  success: 0,
  fail: 0,
  adaptiveHot: 0,
  adaptiveCold: 0,
  adaptiveBaseline: 0,
  adaptiveSuppressed: 0,
}

export interface RevalidateFetcherResult {
  items: any[]
  meta: any
}
export type RevalidateFetcher = () => Promise<RevalidateFetcherResult>

export function maybeScheduleRevalidate(key: string, fetcher: RevalidateFetcher) {
  if (!ENABLED) return
  try {
    // Always (best-effort) register most recent fetcher for Phase 5 prefetch module
    try {
      __registerPrefetch?.(key, fetcher)
    } catch {}
    const info = cacheInfo(key)
    if (!info) {
      metrics.skippedMissing++
      return
    }
    // Compute adaptive threshold if module loaded
    let thresholdMs = FRESH_THRESHOLD_MS
    if (__computeAdaptive) {
      try {
        const decision = __computeAdaptive(FRESH_THRESHOLD_MS, key)
        if (decision) {
          thresholdMs = decision.adjustedThresholdMs
          if (decision.reason === 'hot') metrics.adaptiveHot++
          else if (decision.reason === 'cold') metrics.adaptiveCold++
          else if (decision.reason === 'baseline') metrics.adaptiveBaseline++
          else if (decision.reason === 'suppressed-low') {
            metrics.adaptiveSuppressed++
            return // skip entirely
          }
        }
      } catch {}
    }
    if (info.freshForMs > thresholdMs) {
      metrics.skippedFresh++
      return
    }
    // Rate-limit per key
    const last = lastSuccess.get(key) || 0
    if (Date.now() - last < MIN_INTERVAL_MS) {
      metrics.skippedRecent++
      return
    }
    // Do not start if max inflight reached
    if (currentActive >= MAX_INFLIGHT) {
      metrics.skippedMaxConcurrent++
      return
    }
    // Avoid duplicate inflight
    if (inflight.has(key)) {
      metrics.skippedInflight++
      return
    }
    // Only revalidate if current entry is fresh/stale and not negative
    const any = getAny(key)
    if (!any) {
      metrics.skippedMissing++
      return
    }
    if ((any as any).negative) {
      metrics.skippedNegative++
      return
    }
    const existingFresh = getFresh(key)
    // Fire and forget
    metrics.scheduled++
    const p = (async () => {
      currentActive++
      try {
        const result = await fetcher()
        if (result && Array.isArray(result.items)) {
          setCache(key, result) // reuse default TTL logic
          lastSuccess.set(key, Date.now())
          metrics.success++
          console.log(
            JSON.stringify({
              level: 'info',
              msg: 'bg-revalidate-success',
              key,
              count: result.items.length,
            })
          )
        }
      } catch (e: any) {
        metrics.fail++
        console.log(
          JSON.stringify({
            level: 'warn',
            msg: 'bg-revalidate-fail',
            key,
            error: e?.message || String(e),
          })
        )
      } finally {
        inflight.delete(key)
        currentActive = Math.max(0, currentActive - 1)
      }
    })()
    inflight.set(key, p)
  } catch {}
}

// For tests
export function __resetBgRevalidate() {
  inflight.clear()
  lastSuccess.clear()
  currentActive = 0
  for (const k of Object.keys(metrics)) (metrics as any)[k] = 0
}

export function bgRevalStats() {
  return { ...metrics, inflight: inflight.size, currentActive }
}
