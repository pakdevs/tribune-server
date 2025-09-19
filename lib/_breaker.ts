// Phase 8: Simple per-provider circuit breaker
// States: closed -> open (on failure burst) -> half-open (after cooloff) -> closed (on success)

type State = 'closed' | 'open' | 'half'

type Breaker = {
  state: State
  failures: number // consecutive failures
  openedAt: number // when entered open
  openMs: number // current open duration (may backoff)
  halfOpenInFlight: boolean // allow single trial during half-open
  openedCount: number // number of times opened (for backoff)
}

const map = new Map<string, Breaker>()

function cfgEnabled() {
  return String(process.env.BREAKER_ENABLED || '1') === '1'
}

function cfgFailureBurst() {
  const n = parseInt(String(process.env.BREAKER_FAILURE_BURST || ''), 10)
  return Number.isFinite(n) ? Math.min(20, Math.max(2, n)) : 4
}

function cfgOpenMsBase() {
  const n = parseInt(String(process.env.BREAKER_OPEN_MS || ''), 10)
  // Lower min bound to 50ms to allow fast tests; default remains 30s
  return Number.isFinite(n) ? Math.min(10 * 60_000, Math.max(50, n)) : 30_000
}

function cfgOpenMsMax() {
  const n = parseInt(String(process.env.BREAKER_OPEN_MS_MAX || ''), 10)
  return Number.isFinite(n) ? Math.min(60 * 60_000, Math.max(10_000, n)) : 5 * 60_000
}

function ensure(name: string): Breaker {
  let b = map.get(name)
  if (!b) {
    b = {
      state: 'closed',
      failures: 0,
      openedAt: 0,
      openMs: cfgOpenMsBase(),
      halfOpenInFlight: false,
      openedCount: 0,
    }
    map.set(name, b)
  }
  return b
}

export function allowRequest(name: string): boolean {
  if (!cfgEnabled()) return true
  const b = ensure(name)
  if (b.state === 'closed') return true
  if (b.state === 'open') {
    const now = Date.now()
    if (now - b.openedAt >= b.openMs) {
      // transition to half-open; allow a single probe
      b.state = 'half'
      b.halfOpenInFlight = false
    } else {
      return false
    }
  }
  if (b.state === 'half') {
    if (b.halfOpenInFlight) return false
    b.halfOpenInFlight = true
    return true
  }
  return true
}

export function onSuccess(name: string) {
  if (!cfgEnabled()) return
  const b = ensure(name)
  b.state = 'closed'
  b.failures = 0
  b.halfOpenInFlight = false
  b.openMs = cfgOpenMsBase()
}

export function onFailure(name: string, status?: number) {
  if (!cfgEnabled()) return
  const b = ensure(name)
  // 422 shouldn't count against breaker (client/query error)
  if (String(status) === '422') return
  b.failures += 1
  const burst = cfgFailureBurst()
  if (b.state === 'half') {
    // failed probe -> reopen with backoff
    b.state = 'open'
    b.openedAt = Date.now()
    b.openedCount += 1
    const maxMs = cfgOpenMsMax()
    b.openMs = Math.min(maxMs, Math.max(cfgOpenMsBase(), b.openMs * 2))
    b.halfOpenInFlight = false
    return
  }
  if (b.failures >= burst && b.state === 'closed') {
    b.state = 'open'
    b.openedAt = Date.now()
    b.openedCount += 1
    const maxMs = cfgOpenMsMax()
    b.openMs = Math.min(maxMs, Math.max(cfgOpenMsBase(), b.openMs))
  }
}

export function getBreakerSnapshot() {
  const out: Record<string, any> = {}
  for (const [k, v] of map.entries()) {
    out[k] = {
      state: v.state,
      failures: v.failures,
      openedAt: v.openedAt,
      openMs: v.openMs,
      openedCount: v.openedCount,
      halfOpenInFlight: v.halfOpenInFlight,
    }
  }
  return out
}

// For tests
export function __resetBreaker() {
  map.clear()
}

// Test-only helper: force half-open state allowing a single probe
export function __test_only_forceHalfOpen(name: string) {
  const b = ensure(name)
  b.state = 'half'
  b.halfOpenInFlight = false
}
