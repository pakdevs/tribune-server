import assert from 'assert'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// Use node test runner style (top-level since tsx picks up file)
export async function test() {
  const { setCache, getFresh, getStale, cacheStats } = await import('../api/_cache.js')

  for (let i = 0; i < 10; i++) setCache('k' + i, { v: i }, 5, 5)
  const statsAfter = cacheStats()
  assert(statsAfter.puts >= 10, 'puts should reflect inserts')

  getFresh('k5')
  getFresh('k6')
  getFresh('k7')
  for (let i = 10; i < 200; i++) setCache('k' + i, { v: i }, 5, 5)

  const st = cacheStats()
  assert(st.size <= st.capacity, 'size should not exceed capacity')

  const hit = getFresh('k199')
  assert(hit && hit.v === 199, 'expected recent key hit')
  const miss = getFresh('non-existent-key')
  assert(miss === null, 'expected miss on unknown key')

  const st2 = cacheStats()
  assert(st2.hitsFresh >= st.hitsFresh + 1, 'hitsFresh should increment')
  assert(st2.misses >= st.misses + 1, 'misses should increment')

  setCache('short', { v: 'short' }, 1, 2)
  const s1 = getFresh('short')
  assert(s1, 'fresh short key expected')
  // Wait a bit longer than 1s TTL to accommodate timer drift in CI
  await sleep(1400)
  let s2 = getFresh('short')
  if (s2) {
    // Retry once if clock skew or execution delay kept it fresh
    await sleep(200)
    s2 = getFresh('short')
  }
  assert(s2 === null, 'fresh window should be over after ~1.6s total')
  const s3 = getStale('short')
  assert(s3, 'should still be stale available')
}

export const run = test()
