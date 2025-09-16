import { l2Set, l2Enabled } from './_l2.js'

type Entry = { data: any; expiresAt: number; staleUntil: number; negative?: boolean }

// Phase 2 additions: LRU + basic metrics
interface CacheMetrics {
  puts: number
  hitsFresh: number
  hitsStale: number
  misses: number
  negativePuts: number
  negativeHits: number
  evictionsLRU: number
  evictionsExpired: number
  size: number
  capacity: number
  lastEviction?: string | null
  lastLog?: string | null
  totalLookups: number
  hitRatio: number
  freshRatio: number
  staleRatio: number
  l2Hits: number
  l2Misses: number
  l2Writes: number
  l2Promotions: number
}

// Doubly-linked list node for O(1) LRU updates
interface LRUNode {
  key: string
  prev?: LRUNode
  next?: LRUNode
}

// Simple in-memory cache with fresh + stale windows (ephemeral per serverless instance).
// Phase 1: make TTL configurable via env to align with CDN layer without code changes.
const store: Map<string, Entry> = new Map()

// LRU bookkeeping structures
const nodes: Map<string, LRUNode> = new Map()
let head: LRUNode | undefined // Most recently used
let tail: LRUNode | undefined // Least recently used

// Capacity (entries) configurable; default 500; guardrails 50..10000
const ENV_CAP = parseInt(String((process as any)?.env?.CACHE_MAX_ENTRIES || ''), 10)
const CAPACITY = Number.isFinite(ENV_CAP) ? Math.min(10000, Math.max(50, ENV_CAP)) : 500

const metrics: CacheMetrics = {
  puts: 0,
  hitsFresh: 0,
  hitsStale: 0,
  misses: 0,
  negativePuts: 0,
  negativeHits: 0,
  evictionsLRU: 0,
  evictionsExpired: 0,
  size: 0,
  capacity: CAPACITY,
  lastEviction: null,
  lastLog: null,
  totalLookups: 0,
  hitRatio: 0,
  freshRatio: 0,
  staleRatio: 0,
  l2Hits: 0,
  l2Misses: 0,
  l2Writes: 0,
  l2Promotions: 0,
}

// Read env once; fallback to previous defaults (90s fresh + 600s stale extra)
const ENV_FRESH = parseInt(String((process as any)?.env?.CACHE_FRESH_TTL || ''), 10)
const ENV_STALE_EXTRA = parseInt(String((process as any)?.env?.CACHE_STALE_EXTRA || ''), 10)
// Guardrails to avoid absurd values (fresh 5..1800s, staleExtra 0..7200s)
const DEFAULT_FRESH = 90
const DEFAULT_STALE_EXTRA = 600
const CONFIG_FRESH =
  Number.isFinite(ENV_FRESH) && ENV_FRESH >= 5 && ENV_FRESH <= 1800 ? ENV_FRESH : DEFAULT_FRESH
const CONFIG_STALE_EXTRA =
  Number.isFinite(ENV_STALE_EXTRA) && ENV_STALE_EXTRA >= 0 && ENV_STALE_EXTRA <= 7200
    ? ENV_STALE_EXTRA
    : DEFAULT_STALE_EXTRA

export function makeKey(parts: Array<string | number | undefined | null>) {
  return parts.filter(Boolean).join('|')
}

export function setCache(
  key: string,
  payload: any,
  ttlSeconds: number = CONFIG_FRESH,
  staleExtraSeconds: number = CONFIG_STALE_EXTRA
) {
  const safeFresh = Math.min(1800, Math.max(1, ttlSeconds || CONFIG_FRESH))
  const safeStaleExtra = Math.min(7200, Math.max(0, staleExtraSeconds || CONFIG_STALE_EXTRA))
  const now = Date.now()
  store.set(key, {
    data: payload,
    expiresAt: now + safeFresh * 1000,
    staleUntil: now + (safeFresh + safeStaleExtra) * 1000,
  })
  touchLRU(key)
  metrics.puts++
  metrics.size = store.size
  // Periodic purge every 100 insertions to remove dead stale entries (cheap heuristic)
  ;(setCache as any).__count = ((setCache as any).__count || 0) + 1
  if ((setCache as any).__count % 100 === 0) {
    try {
      purgeExpired()
    } catch {}
  }
  enforceCapacity()
  // Async write-through to L2 (fire-and-forget). Skip if disabled or payload flagged negative.
  try {
    if (l2Enabled() && !payload?.__negative && !payload?.negative) {
      Promise.resolve(l2Set(key, payload, safeFresh))
        .then(() => {
          ;(metrics as any).l2Writes++
        })
        .catch(() => {})
    }
  } catch {}
}

export function getFresh<T = any>(key: string): T | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() < entry.expiresAt) return entry.data as T
  return null
}

export function getStale<T = any>(key: string): T | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() < entry.staleUntil) return entry.data as T
  return null
}

export function cacheInfo(key: string) {
  const entry = store.get(key)
  if (!entry) return null
  return {
    freshForMs: Math.max(0, entry.expiresAt - Date.now()),
    staleForMs: Math.max(0, entry.staleUntil - Date.now()),
  }
}

export function purgeExpired() {
  const now = Date.now()
  for (const [k, v] of store.entries()) {
    if (now > v.staleUntil) {
      store.delete(k)
      metrics.evictionsExpired++
    }
  }
  // Rebuild LRU list lazily if many deletions happened; for simplicity we leave nodes for
  // expired keys (they will be cleaned when accessed or during eviction walk).
}

// LRU Helpers
function removeNode(node: LRUNode) {
  if (node.prev) node.prev.next = node.next
  if (node.next) node.next.prev = node.prev
  if (head === node) head = node.next
  if (tail === node) tail = node.prev
  node.prev = node.next = undefined
}

function addToFront(node: LRUNode) {
  node.prev = undefined
  node.next = head
  if (head) head.prev = node
  head = node
  if (!tail) tail = node
}

function touchLRU(key: string) {
  let node = nodes.get(key)
  if (!node) {
    node = { key }
    nodes.set(key, node)
    addToFront(node)
    return
  }
  // Move to front
  removeNode(node)
  addToFront(node)
}

function evictLRU() {
  if (!tail) return
  const node = tail
  removeNode(node)
  nodes.delete(node.key)
  if (store.delete(node.key)) {
    metrics.evictionsLRU++
    metrics.lastEviction = new Date().toISOString()
    metrics.size = store.size
  }
}

function enforceCapacity() {
  while (store.size > CAPACITY) {
    evictLRU()
  }
}

// Stats wrappers
export function cacheStats(): CacheMetrics {
  recomputeRatios()
  return { ...metrics, size: store.size }
}

// Instrument getFresh/getStale by wrapping original exports (keep original logic above)
const _origGetFresh = getFresh
const _origGetStale = getStale

// Redefine exported functions with metrics + LRU touch on hit
export function getFreshWithMetrics<T = any>(key: string): T | null {
  const v = _origGetFresh<T>(key)
  if (v !== null) {
    metrics.hitsFresh++
    touchLRU(key)
    metrics.totalLookups++
    maybeLog()
    return v
  }
  metrics.misses++
  metrics.totalLookups++
  maybeLog()
  return null
}

export function getStaleWithMetrics<T = any>(key: string): T | null {
  const v = _origGetStale<T>(key)
  if (v !== null) {
    metrics.hitsStale++
    touchLRU(key)
    metrics.totalLookups++
    maybeLog()
    return v
  }
  return null
}

// Backwards compatibility: keep old names but now pointing to instrumented versions
// (Consumers can gradually migrate to getFreshWithMetrics if they want explicitness.)
;(getFresh as any) = getFreshWithMetrics
;(getStale as any) = getStaleWithMetrics

// Negative cache utilities
export function setNegativeCache(key: string, payload: any = { error: 'negative-cache' }, ttl = 5) {
  const now = Date.now()
  const safeFresh = Math.max(1, Math.min(30, ttl)) // keep tiny
  const staleExtra = Math.min(60, safeFresh * 2)
  store.set(key, {
    data: { ...payload, __negative: true },
    expiresAt: now + safeFresh * 1000,
    staleUntil: now + (safeFresh + staleExtra) * 1000,
    negative: true,
  })
  touchLRU(key)
  metrics.negativePuts++
  metrics.size = store.size
  enforceCapacity()
}

export function isNegative(entry: any) {
  return !!entry?.__negative || !!entry?.negative
}

// Provide a direct accessor used by endpoints to detect negative cached payloads
export function getAny<T = any>(key: string): { data: T; negative?: boolean } | null {
  const entry = (store as any).get(key)
  if (!entry) return null
  if (Date.now() > entry.staleUntil) return null
  return { data: entry.data, negative: entry.negative }
}

export function resetCacheStats() {
  for (const k of Object.keys(metrics) as (keyof CacheMetrics)[]) {
    if (typeof metrics[k] === 'number') (metrics as any)[k] = 0
  }
  metrics.capacity = CAPACITY
  metrics.lastEviction = null
  metrics.lastLog = null
}

function recomputeRatios() {
  const total = Math.max(1, metrics.totalLookups)
  const hits = metrics.hitsFresh + metrics.hitsStale
  metrics.hitRatio = hits / total
  metrics.freshRatio = metrics.hitsFresh / total
  metrics.staleRatio = metrics.hitsStale / total
}

function maybeLog() {
  const now = Date.now()
  // Log at most every 5 minutes or after 2000 lookups increments
  const last = metrics.lastLog ? Date.parse(metrics.lastLog) : 0
  if (now - last < 300_000 && metrics.totalLookups % 2000 !== 0) return
  recomputeRatios()
  metrics.lastLog = new Date().toISOString()
  try {
    // Structured single-line JSON for easy ingestion
    const l2Total = (metrics as any).l2Hits + (metrics as any).l2Misses
    const l2HitRatio = l2Total ? (metrics as any).l2Hits / l2Total : 0
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'cache-metrics',
        cache: {
          puts: metrics.puts,
          hitsFresh: metrics.hitsFresh,
          hitsStale: metrics.hitsStale,
          misses: metrics.misses,
          negativePuts: metrics.negativePuts,
          negativeHits: metrics.negativeHits,
          evictionsLRU: metrics.evictionsLRU,
          evictionsExpired: metrics.evictionsExpired,
          size: metrics.size,
          capacity: metrics.capacity,
          hitRatio: Number(metrics.hitRatio.toFixed(4)),
          freshRatio: Number(metrics.freshRatio.toFixed(4)),
          staleRatio: Number(metrics.staleRatio.toFixed(4)),
          l2Hits: (metrics as any).l2Hits,
          l2Misses: (metrics as any).l2Misses,
          l2Writes: (metrics as any).l2Writes,
          l2Promotions: (metrics as any).l2Promotions,
          l2HitRatio: Number(l2HitRatio.toFixed(4)),
        },
      })
    )
    if (l2Total > 50 && l2HitRatio < 0.1) {
      console.log(
        JSON.stringify({
          level: 'warn',
          msg: 'l2-low-hit-ratio',
          l2HitRatio: Number(l2HitRatio.toFixed(4)),
          l2Hits: (metrics as any).l2Hits,
          l2Misses: (metrics as any).l2Misses,
        })
      )
    }
  } catch {}
}

// Phase 3 helper: attempt memory fresh first, then L2 (if enabled). Does NOT promote to memory automatically.
export async function getFreshOrL2<T = any>(key: string): Promise<T | null> {
  const v = getFresh<T>(key)
  if (v !== null) return v
  try {
    if (l2Enabled()) {
      const l2 = await (await import('./_l2.js')).l2Get<T>(key)
      if (l2 !== null && l2 !== undefined) {
        ;(metrics as any).l2Hits++
        // Optional promotion back into memory (fresh only) if env flag set
        if (String(process.env.L2_PROMOTE_ON_HIT || '1') === '1') {
          try {
            // Reinsert with standard fresh TTL (no stale extension change).
            setCache(key, l2)
            ;(metrics as any).l2Promotions++
          } catch {}
        }
        return l2
      } else {
        ;(metrics as any).l2Misses++
      }
    }
  } catch {}
  return null
}

// Test-only utility: remove a key from in-memory store (to simulate cold miss with L2 hit)
export function __deleteMemoryKey(key: string) {
  store.delete(key)
}

// Administrative purge helpers (memory layer only). Use with caution.
export function purgeKey(key: string) {
  if (store.delete(key)) {
    metrics.size = store.size
    return true
  }
  return false
}

export function purgePrefix(prefix: string) {
  let count = 0
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) {
      store.delete(k)
      count++
    }
  }
  if (count) metrics.size = store.size
  return count
}
