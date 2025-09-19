// Adaptive revalidation activity tracking (Phase 4+ enhancement)
// Maintains lightweight per-key hit EMA (hits per minute) and exposes
// functions to influence background revalidation scheduling.

interface AdaptiveConfig {
  enabled: boolean
  maxKeys: number
  alpha: number // EMA smoothing factor
  hotHPM: number
  coldHPM: number
  hotFactor: number
  coldFactor: number
  minHPMToSchedule: number
}

const cfg: AdaptiveConfig = {
  enabled: String(process.env.ADAPTIVE_REVAL_ENABLED || '1') === '1',
  maxKeys: clampInt(process.env.ADAPTIVE_MAX_KEYS, 50, 2000, 200),
  alpha: clampFloat(process.env.ADAPTIVE_EMA_ALPHA, 0.01, 0.9, 0.2),
  hotHPM: clampFloat(process.env.ADAPTIVE_HOT_HPM, 1, 5000, 30),
  coldHPM: clampFloat(process.env.ADAPTIVE_COLD_HPM, 0.1, 1000, 2),
  hotFactor: clampFloat(process.env.ADAPTIVE_HOT_FACTOR, 1, 10, 2.0),
  coldFactor: clampFloat(process.env.ADAPTIVE_COLD_FACTOR, 0.05, 1, 0.5),
  minHPMToSchedule: clampFloat(process.env.ADAPTIVE_MIN_HPM_TO_SCHEDULE, 0.01, 10, 0.2),
}

function clampInt(v: any, min: number, max: number, d: number) {
  const n = parseInt(String(v || ''), 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d
}
function clampFloat(v: any, min: number, max: number, d: number) {
  const n = parseFloat(String(v || ''))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d
}

// Internal data structure: Map key -> { emaHPM, lastHitMs, hitsWindow }
// We approximate hits per minute via EMA updated on each hit:
// Given time delta dt (ms) since last hit, instantaneous rate r = 60000 / dt
// ema = alpha * r + (1-alpha) * emaPrev
interface AdaptiveEntry {
  emaHPM: number
  lastHitMs: number
}
const entries: Map<string, AdaptiveEntry> = new Map()

// Maintain insertion order for simple LRU eviction when size exceeds maxKeys.
function ensureCapacity() {
  if (entries.size <= cfg.maxKeys) return
  const overflow = entries.size - cfg.maxKeys
  // Evict oldest 'overflow' entries (iteration order of Map preserves insertion; acceptable heuristic)
  let i = 0
  for (const k of entries.keys()) {
    entries.delete(k)
    i++
    if (i >= overflow) break
  }
}

export function recordHit(key: string) {
  if (!cfg.enabled) return
  const now = Date.now()
  const e = entries.get(key)
  if (!e) {
    entries.set(key, { emaHPM: 1, lastHitMs: now })
    ensureCapacity()
    return
  }
  const dt = now - e.lastHitMs
  e.lastHitMs = now
  const adjDt = dt <= 0 ? 1 : dt
  const instantaneous = adjDt > 600000 ? 0 : 60000 / adjDt // if >10m gap treat as zero
  e.emaHPM = cfg.alpha * instantaneous + (1 - cfg.alpha) * e.emaHPM
}

export interface AdaptiveDecision {
  adjustedThresholdMs: number
  reason: 'hot' | 'cold' | 'baseline' | 'suppressed-low' | 'disabled'
  emaHPM: number
  scheduled: boolean
  skip: boolean
}

export function computeAdaptiveThreshold(baseMs: number, key: string): AdaptiveDecision {
  if (!cfg.enabled) {
    return {
      adjustedThresholdMs: baseMs,
      reason: 'disabled',
      emaHPM: 0,
      scheduled: true,
      skip: false,
    }
  }
  const e = entries.get(key)
  const ema = e ? e.emaHPM : 0
  if (ema < cfg.minHPMToSchedule) {
    return {
      adjustedThresholdMs: baseMs,
      reason: 'suppressed-low',
      emaHPM: ema,
      scheduled: false,
      skip: true,
    }
  }
  if (ema >= cfg.hotHPM) {
    return {
      adjustedThresholdMs: clampInt(baseMs * cfg.hotFactor, 100, 3600000, baseMs),
      reason: 'hot',
      emaHPM: ema,
      scheduled: true,
      skip: false,
    }
  }
  if (ema <= cfg.coldHPM) {
    return {
      adjustedThresholdMs: Math.max(100, Math.floor(baseMs * cfg.coldFactor)),
      reason: 'cold',
      emaHPM: ema,
      scheduled: true,
      skip: false,
    }
  }
  return {
    adjustedThresholdMs: baseMs,
    reason: 'baseline',
    emaHPM: ema,
    scheduled: true,
    skip: false,
  }
}

export function adaptiveStats(limit = 20) {
  if (!cfg.enabled) return { enabled: false }
  // Return top keys by emaHPM
  const arr: Array<{ key: string; emaHPM: number; ageMs: number }> = []
  const now = Date.now()
  for (const [k, v] of entries.entries()) {
    arr.push({ key: k, emaHPM: Number(v.emaHPM.toFixed(2)), ageMs: now - v.lastHitMs })
  }
  arr.sort((a, b) => b.emaHPM - a.emaHPM)
  return {
    enabled: true,
    total: arr.length,
    hotSample: arr.slice(0, limit),
    updatedAt: new Date().toISOString(),
    cfg,
  }
}

export function resetAdaptive() {
  entries.clear()
}
