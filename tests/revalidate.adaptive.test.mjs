import assert from 'assert'

export async function test() {
  // Force adaptive with tiny thresholds so test runs fast
  process.env.ADAPTIVE_REVAL_ENABLED = '1'
  process.env.ADAPTIVE_EMA_ALPHA = '0.8'
  process.env.ADAPTIVE_HOT_HPM = '20'
  process.env.ADAPTIVE_COLD_HPM = '5'
  process.env.ADAPTIVE_HOT_FACTOR = '3'
  process.env.ADAPTIVE_COLD_FACTOR = '0.5'
  process.env.ADAPTIVE_MIN_HPM_TO_SCHEDULE = '0.05'
  process.env.BG_REVALIDATE_FRESH_THRESHOLD_MS = '5000'
  const { setCache, getFresh } = await import('../api/_cache.js')
  const { maybeScheduleRevalidate, __resetBgRevalidate, bgRevalStats } = await import(
    '../api/_revalidate.ts'
  )
  const { recordHit, computeAdaptiveThreshold, resetAdaptive } = await import('../api/_adaptive.ts')
  __resetBgRevalidate()
  resetAdaptive()
  const hotKey = 'adaptive:hot'
  const coldKey = 'adaptive:cold'
  setCache(hotKey, { items: [{ v: 1 }], meta: { provider: 'x', attempts: ['x'] } }, 1, 5)
  setCache(coldKey, { items: [{ v: 1 }], meta: { provider: 'x', attempts: ['x'] } }, 1, 5)
  // Simulate many rapid hits for hotKey
  for (let i = 0; i < 60; i++) recordHit(hotKey)
  // Single hit for cold key so ema stays low (<= coldHPM)
  for (let i = 0; i < 1; i++) recordHit(coldKey)
  const base = 3000
  const hotDecision = computeAdaptiveThreshold(base, hotKey)
  const coldDecision = computeAdaptiveThreshold(base, coldKey)
  assert(hotDecision.reason === 'hot', 'hot key should be classified as hot')
  assert(hotDecision.adjustedThresholdMs > base, 'hot should elevate threshold')
  assert(coldDecision.adjustedThresholdMs < base, 'cold should reduce threshold')
  // Schedule both
  maybeScheduleRevalidate(hotKey, async () => ({
    items: [{ v: 2 }],
    meta: { provider: 'y', attempts: ['y'] },
  }))
  maybeScheduleRevalidate(coldKey, async () => ({
    items: [{ v: 2 }],
    meta: { provider: 'y', attempts: ['y'] },
  }))
  await new Promise((r) => setTimeout(r, 80))
  const stats = bgRevalStats()
  // Both may schedule; ensure at least one success
  assert(stats.success >= 1, 'expected at least one adaptive revalidation success')
}

export const run = test()
