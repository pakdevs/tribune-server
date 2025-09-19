import assert from 'assert'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function test() {
  const { setNegativeCache, getFresh, getStale, getAny, cacheStats } = await import(
    '../lib/_cache.js'
  )
  const key = 'neg:test'
  setNegativeCache(key, { error: 'upstream-failure' }, 2) // fresh 2s, stale up to 6s (2 + extra)
  const any1 = getAny(key)
  assert(any1 && any1.negative, 'negative cache should be stored')
  const fresh1 = getFresh(key)
  assert(fresh1 && fresh1.__negative, 'fresh negative payload accessible during fresh window')
  await sleep(2200) // past fresh, within stale
  const fresh2 = getFresh(key)
  assert(fresh2 === null, 'fresh window over')
  const stale1 = getStale(key)
  assert(stale1 && stale1.__negative, 'still stale negative available')
  await sleep(4200) // total ~6.4s > fresh+stale extra
  const stale2 = getStale(key)
  assert(stale2 === null, 'stale window expired')
  const any2 = getAny(key)
  assert(any2 === null, 'getAny should also respect stale expiry')
  const stats = cacheStats()
  assert(stats.negativePuts >= 1, 'negativePuts should increment')
}

export const run = test()
