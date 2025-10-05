import assert from 'assert'

export async function test() {
  // Enable L2 before importing cache module
  process.env.ENABLE_L2_CACHE_MUS = '1'
  delete process.env.ENABLE_L2_CACHE
  try {
    const { setCache, __deleteMemoryKey, getFresh, getFreshOrL2 } = await import('../lib/_cache.js')
    const { l2Set } = await import('../lib/_l2.js')
    const key = 'l2:test:key'
    setCache(key, { value: 42 }, 10, 10)
    // Explicitly mirror to L2 (write-through is async fire-and-forget; ensure presence for test determinism)
    await l2Set(key, { value: 42 }, 10)
    let v = getFresh(key)
    assert(v && v.value === 42, 'fresh value should be available initially')
    // Simulate instance memory eviction while L2 still has it (write-through previously happened)
    __deleteMemoryKey(key)
    const mem = getFresh(key)
    assert(mem === null, 'memory entry removed')
    const l2 = await getFreshOrL2(key)
    assert(l2 && l2.value === 42, 'should retrieve from L2 fallback')
  } finally {
    delete process.env.ENABLE_L2_CACHE_MUS
    delete process.env.ENABLE_L2_CACHE
  }
}

export const run = test()
