import assert from 'assert'

export async function test() {
  // Configure tight budget
  process.env.GNEWS_DAILY_LIMIT = '5'
  process.env.GNEWS_CALL_COST = '1'
  process.env.BUDGET_SOFT_REMAIN = '3'
  process.env.ENABLE_BG_REVALIDATE = '1'
  process.env.BG_REVALIDATE_FRESH_THRESHOLD_MS = '2000'

  const { setCache } = await import('../lib/_cache.js')
  const { maybeScheduleRevalidate, __resetBgRevalidate, bgRevalStats } = await import(
    '../lib/_revalidate.ts'
  )
  const { spend, getUsedToday } = await import('../lib/_budget.ts')

  __resetBgRevalidate()

  const key = 'budget:guard'
  // Make the entry near-expiry so maybeScheduleRevalidate would normally schedule
  setCache(key, { items: [{ v: 1 }], meta: { provider: 'x', attempts: ['x'] } }, 1, 0.5)

  // Spend up to leave only soft remain
  spend('gnews', 2)
  assert.strictEqual(getUsedToday('gnews'), 2)

  // With limit=5 and soft=3, remaining=3; guard should skip (<= soft)
  maybeScheduleRevalidate(key, async () => ({
    items: [{ v: 2 }],
    meta: { provider: 'x', attempts: ['x'] },
  }))

  // Allow async queue
  await new Promise((r) => setTimeout(r, 20))

  const stats = bgRevalStats()
  // Ensure that nothing scheduled due to guard
  assert.strictEqual(
    stats.scheduled,
    0,
    'revalidate should not be scheduled under soft budget guard'
  )
}

export const run = test()
