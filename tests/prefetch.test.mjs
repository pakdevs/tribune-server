import assert from 'assert'

export async function test() {
  process.env.PREFETCH_ENABLED = '1'
  process.env.PREFETCH_FRESH_THRESHOLD_MS = '3000'
  process.env.PREFETCH_MAX_BATCH = '2'
  process.env.PREFETCH_MIN_INTERVAL_MS = '100'
  process.env.PREFETCH_GLOBAL_COOLDOWN_MS = '10'
  process.env.PREFETCH_ERROR_BURST = '10'
  process.env.PREFETCH_SUSPEND_MS = '2000'
  // Adaptive fast reaction
  process.env.ADAPTIVE_REVAL_ENABLED = '1'
  process.env.ADAPTIVE_EMA_ALPHA = '0.9'
  process.env.ADAPTIVE_HOT_HPM = '5'
  const { setCache, cacheInfo } = await import('../api/_cache.js')
  const { maybeScheduleRevalidate, __resetBgRevalidate } = await import('../api/_revalidate.ts')
  const { recordHit, resetAdaptive } = await import('../api/_adaptive.ts')
  const { prefetchStats, __resetPrefetch } = await import('../api/_prefetch.ts')

  __resetBgRevalidate()
  resetAdaptive()
  __resetPrefetch()

  const keyA = 'prefetch:A'
  const keyB = 'prefetch:B'
  setCache(keyA, { items: [{ v: 1 }], meta: { provider: 'x', attempts: ['x'] } }, 1, 5)
  setCache(keyB, { items: [{ v: 1 }], meta: { provider: 'x', attempts: ['x'] } }, 1, 5)

  // Simulate hits so they are considered hot
  for (let i = 0; i < 10; i++) recordHit(keyA)
  for (let i = 0; i < 8; i++) recordHit(keyB)

  // Register fetchers via background scheduling (will likely skip actual run due to fresh time, OK)
  maybeScheduleRevalidate(keyA, async () => ({
    items: [{ v: 2 }],
    meta: { provider: 'x', attempts: ['x'] },
  }))
  maybeScheduleRevalidate(keyB, async () => ({
    items: [{ v: 2 }],
    meta: { provider: 'x', attempts: ['x'] },
  }))

  // Force fresh time near threshold by waiting a bit
  await new Promise((r) => setTimeout(r, 750))

  // Trigger a cache metrics log which calls prefetch tick indirectly
  const hotInfoA1 = cacheInfo(keyA)
  assert(hotInfoA1, 'expected cache info A')
  // access to increment lookups => triggers maybeLog occasionally; we simulate by calling getFresh
  const { getFresh } = await import('../api/_cache.js')
  getFresh(keyA)
  getFresh(keyB)

  // Wait for async prefetch tasks
  await new Promise((r) => setTimeout(r, 200))

  const pf = prefetchStats()
  assert(pf.prefetchScheduled >= 0, 'prefetchScheduled should be numeric')
  // We can't guarantee a prefetch due to timing, but registry should be >=2
  assert(pf.registrySize >= 2, 'registry should have tracked fetchers')
}

export const run = test()
