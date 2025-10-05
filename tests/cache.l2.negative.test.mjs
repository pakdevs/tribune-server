import assert from 'assert'

/**
 * Ensure negative cache entries are not written to L2.
 */
export async function test() {
  process.env.ENABLE_L2_CACHE_MUS = '1'
  delete process.env.ENABLE_L2_CACHE
  process.env.L2_TTL_MULT = '2'
  try {
    // Spy on l2Set by temporarily importing and wrapping after module load
    const cacheMod = await import('../lib/_cache.js')
    const l2Mod = await import('../lib/_l2.js')
    const key = 'neg:l2:test'
    // Insert negative cache entry
    cacheMod.setNegativeCache(key, { error: 'fail' }, 2)
    // Call setCache with negative payload should not happen; we rely on logic in setNegativeCache only.
    // Try retrieving via L2 (should miss)
    const l2Val = await l2Mod.l2Get(key)
    assert(l2Val === null, 'negative entry must not appear in L2')
  } finally {
    delete process.env.ENABLE_L2_CACHE_MUS
    delete process.env.ENABLE_L2_CACHE
    delete process.env.L2_TTL_MULT
  }
}

export const run = test()
