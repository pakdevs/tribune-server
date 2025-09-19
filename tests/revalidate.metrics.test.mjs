import assert from 'assert'

// Tests for background revalidation metrics: scheduling, recent skip, concurrency cap
export async function test() {
  process.env.ENABLE_BG_REVALIDATE = '1'
  process.env.ADAPTIVE_REVAL_ENABLED = '0' // disable adaptive for deterministic skipRecent test
  process.env.BG_REVALIDATE_FRESH_THRESHOLD_MS = '120000' // large so fresh TTL (90s) remains below threshold and not skipped as fresh
  process.env.BG_MIN_INTERVAL_MS = '10000'
  process.env.BG_MAX_INFLIGHT = '2'
  const { setCache } = await import('../lib/_cache.js')
  const { maybeScheduleRevalidate, __resetBgRevalidate, bgRevalStats } = await import(
    '../lib/_revalidate.ts'
  )
  __resetBgRevalidate()
  const key = 'reval:metrics'
  // Fresh TTL 1s so it is below threshold immediately
  setCache(key, { items: [{ v: 1 }], meta: { provider: 'a', attempts: ['a'] } }, 1, 5)

  maybeScheduleRevalidate(key, async () => ({
    items: [{ v: 2 }],
    meta: { provider: 'b', attempts: ['b'] },
  }))
  // Poll until success recorded (avoid race with async task scheduling)
  let stats
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 30))
    stats = bgRevalStats()
    if (stats.success === 1) break
  }
  assert(stats.success === 1, 'expected 1 success after background task')
  assert(stats.scheduled === 1, 'expected 1 scheduled')
  assert(stats.skippedFresh === 0, 'should not have skipped by fresh threshold')

  // Immediate second attempt should be skippedRecent (lastSuccess set by first run)
  maybeScheduleRevalidate(key, async () => ({
    items: [{ v: 3 }],
    meta: { provider: 'c', attempts: ['c'] },
  }))
  // Allow synchronous path to update skip metric
  stats = bgRevalStats()
  assert.strictEqual(stats.skippedRecent, 1, 'expected skippedRecent increment')

  // Concurrency cap scenario
  __resetBgRevalidate()
  process.env.BG_REVALIDATE_FRESH_THRESHOLD_MS = '5000'
  process.env.BG_MIN_INTERVAL_MS = '0' // allow all to attempt
  process.env.BG_MAX_INFLIGHT = '1'
  const {
    maybeScheduleRevalidate: msr2,
    bgRevalStats: stats2,
    __resetBgRevalidate: reset2,
  } = await import('../lib/_revalidate.ts')
  reset2()
  setCache('k1', { items: [{ v: 1 }], meta: { provider: 'a', attempts: ['a'] } }, 1, 5)
  setCache('k2', { items: [{ v: 1 }], meta: { provider: 'a', attempts: ['a'] } }, 1, 5)
  setCache('k3', { items: [{ v: 1 }], meta: { provider: 'a', attempts: ['a'] } }, 1, 5)
  msr2('k1', async () => ({ items: [{ v: 2 }], meta: { provider: 'x', attempts: ['x'] } }))
  msr2('k2', async () => ({ items: [{ v: 2 }], meta: { provider: 'x', attempts: ['x'] } }))
  msr2('k3', async () => ({ items: [{ v: 2 }], meta: { provider: 'x', attempts: ['x'] } }))
  await new Promise((r) => setTimeout(r, 60))
  const s2 = stats2()
  // Concurrency invariant: scheduled + skippedMaxConcurrent >= 3 (we attempted 3)
  assert(s2.scheduled + s2.skippedMaxConcurrent >= 3, 'expected all attempts accounted for')
  assert(s2.skippedMaxConcurrent >= 1, 'expected at least one concurrency skip')
}

export const run = test()
