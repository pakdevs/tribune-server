import assert from 'assert'

// Test background revalidation scheduling logic.
export async function test() {
  process.env.ENABLE_BG_REVALIDATE = '1'
  process.env.BG_REVALIDATE_FRESH_THRESHOLD_MS = '999999' // force immediate scheduling
  const { setCache, getFresh } = await import('../lib/_cache.js')
  const { maybeScheduleRevalidate, __resetBgRevalidate } = await import('../lib/_revalidate.ts')
  __resetBgRevalidate()
  const key = 'reval:test'
  setCache(key, { items: [{ v: 1 }], meta: { provider: 'x', attempts: ['x'] } }, 1, 10)
  // Provide fetcher that changes value
  await maybeScheduleRevalidate(key, async () => {
    return { items: [{ v: 2 }], meta: { provider: 'y', attempts: ['y'] } }
  })
  // Wait a tick for async task
  await new Promise((r) => setTimeout(r, 50))
  const val = getFresh(key)
  assert(val && val.items[0].v === 2, 'Value should be updated by background revalidation')
}

export const run = test()
